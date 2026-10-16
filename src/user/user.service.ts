import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { EditUserDto } from './dto/edit-user.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { USER_PUBLIC_SELECT } from './user.select';
import { Prisma, UserRole } from '@prisma/client';
import { BCRYPT_ROUNDS } from 'src/common/utils/password.util';
import {
  buildPaginationMeta,
  resolvePagination,
} from 'src/common/utils/pagination.util';

/**
 * Bloqueo consultivo para las operaciones que pueden dejar el sistema sin
 * administradores. Distinto del 7001 de caja.
 */
const LOCK_ADMINISTRADORES = 7002;

/** Resumen de sesiones que se muestra en la lista de usuarios. */
export interface UserSessionInfo {
  /** Sesiones vigentes (refresh tokens no revocados ni caducados). */
  active: number;
  /** Última actividad conocida entre esas sesiones. */
  lastSeenAt: Date | null;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Crea un nuevo usuario
   * @param data Dto de CreateUserDto
   * @returns  El usuario creado
   */
  async createUser(data: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    return this.prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        userName: data.userName,
        email: data.email,
        password: hashedPassword,
        role: data.role,
      },
      select: USER_PUBLIC_SELECT,
    });
  }

  /**
   * Obtiene todos los usuarios
   * @param active Si es true, solo obtiene los usuarios activos. Si es false, solo los inactivos. Si es undefined, obtiene todos.
   * @param pagination Parametros de paginacion (opcional)
   * @returns  Lista de usuarios
   */
  async getAllUsers(active?: boolean, pagination?: PaginationParamsDto) {
    const paginacion = resolvePagination(pagination);

    let whereClause = {};
    if (active === true) {
      whereClause = { isActive: true };
    } else if (active === false) {
      whereClause = { isActive: false };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        skip: paginacion.skip,
        take: paginacion.take,
        orderBy: { userName: 'desc' },
        select: USER_PUBLIC_SELECT,
      }),
      this.prisma.user.count({ where: whereClause }),
    ]);

    return {
      users: await this.withSessionInfo(users),
      pagination: buildPaginationMeta(total, paginacion),
    };
  }

  /**
   * Obtiene un usuario por ID
   * @param id Id del usuario
   * @returns El usaurio encontrado o null si no existe
   */
  async getUserById(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_PUBLIC_SELECT,
    });
    if (!user) {
      throw new NotFoundException('Usuario no existente');
    }

    return user;
  }

  /**
   * Busca un usuario por su ID o email o username
   * @param id
   * @param email
   * @param userName
   * @returns el usuario encontrado o null si no existe
   */
  async findUser(
    email?: string,
    userName?: string,
    active?: boolean,
    pagination?: PaginationParamsDto,
  ) {
    const paginacion = resolvePagination(pagination);

    // 1. Condiciones de BÚSQUEDA (OR) - texto
    const searchConditions: Prisma.UserWhereInput[] = [];

    if (email) {
      searchConditions.push({
        email: { contains: email, mode: 'insensitive' },
      });
    }
    if (userName) {
      // El texto de "usuario" también busca en nombre y apellido: en la
      // pantalla de Usuarios se escribe "María" tanto como "maria.lopez".
      searchConditions.push(
        { userName: { contains: userName, mode: 'insensitive' } },
        { firstName: { contains: userName, mode: 'insensitive' } },
        { lastName: { contains: userName, mode: 'insensitive' } },
      );
    }

    // 2. Condiciones de FILTRO (AND) - booleanos, exactos
    const filterConditions: Prisma.UserWhereInput = {};

    if (active !== undefined) {
      filterConditions.isActive = { equals: active };
    }

    // 3. Combinar condiciones: (búsqueda OR) AND (filtros)
    const where: Prisma.UserWhereInput = { ...filterConditions };

    if (searchConditions.length > 0) {
      where.OR = searchConditions;
    }

    // Si no hay condiciones, where será un objeto vacío {}

    // CON paginación
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: paginacion.skip,
        take: paginacion.take,
        orderBy: { userName: 'desc' },
        select: USER_PUBLIC_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: await this.withSessionInfo(users),
      pagination: buildPaginationMeta(total, paginacion),
    };
  }

  /**
   * Editar un usuario
   * @param data Dto de EditUser
   */
  async editUser(id: number, data: EditUserDto, actorId?: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException('Usuario no existente');
    }

    // ── Salvaguardas de acceso ───────────────────────────────────────────
    // Antes un administrador podía darse de baja o quitarse el rol a sí
    // mismo —por un clic equivocado en el formulario— y perder el acceso a
    // esta misma pantalla. Y si era el único, la farmacia quedaba sin nadie
    // capaz de administrar usuarios: sólo se recuperaba tocando la base.
    if (actorId !== undefined && id === actorId) {
      if (data.isActive === false) {
        throw new BadRequestException(
          'No puedes desactivar tu propia cuenta. Pide a otro administrador que lo haga.',
        );
      }
      if (data.role !== undefined && data.role !== user.role) {
        throw new BadRequestException(
          'No puedes cambiar tu propio rol: perderías el acceso a esta pantalla. Pide a otro administrador que lo haga.',
        );
      }
    }
    const quitaUnAdministrador =
      user.role === UserRole.ADMIN &&
      user.isActive &&
      ((data.role !== undefined && data.role !== UserRole.ADMIN) ||
        data.isActive === false);

    //Validar password
    let hashedPassword: string | undefined = undefined;
    if (data.password) {
      hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    }

    // ¿Este cambio invalida las sesiones abiertas?
    //
    // Antes, cambiarle la contraseña a un usuario —o bajarle el rol, o darlo de
    // baja— no cerraba sus sesiones. Si el cambio se hacía PORQUE su cuenta
    // estaba comprometida, el atacante seguía dentro con su refresh token
    // durante días. Y un cajero degradado conservaba permisos de gerente hasta
    // que su token caducaba.
    const invalidaSesiones =
      hashedPassword !== undefined ||
      (data.role !== undefined && data.role !== user.role) ||
      data.isActive === false;

    return await this.prisma.$transaction(async (tx) => {
      if (quitaUnAdministrador) {
        await this.asegurarOtroAdministrador(tx, id);
      }

      const actualizado = await tx.user.update({
        where: { id },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          userName: data.userName,
          email: data.email,
          role: data.role,
          isActive: data.isActive,
          password: hashedPassword ? hashedPassword : undefined,
        },
        select: USER_PUBLIC_SELECT,
      });

      if (invalidaSesiones) {
        await this.revocarSesiones(tx, id);
      }

      return actualizado;
    });
  }

  /**
   * Revoca TODOS los refresh tokens vigentes de un usuario.
   *
   * El access token que ya tenga sigue valiendo hasta que caduque (15 min por
   * defecto): es el precio de no consultar la base en cada petición para el
   * token. Pero el `JwtStrategy` sí relee `isActive` en cada petición, así que
   * una baja surte efecto de inmediato; y un cambio de rol se aplica en la
   * siguiente renovación, que ya no será posible.
   */
  private async revocarSesiones(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<void> {
    await tx.userToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });
  }

  /**
   * Eliminar un usuario
   * @param id Id del usuario a eliminar
   */
  async deleteUser(id: number, actorId?: number) {
    //Validar que el usuario exista
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException('Usuario no existente');
    }
    if (actorId !== undefined && id === actorId) {
      throw new BadRequestException(
        'No puedes dar de baja tu propia cuenta. Pide a otro administrador que lo haga.',
      );
    }

    // Dar de baja cierra sus sesiones en el mismo movimiento. Si no, el usuario
    // despedido seguía pudiendo renovar su sesión hasta que el refresh token
    // caducara por su cuenta.
    return await this.prisma.$transaction(async (tx) => {
      if (user.role === UserRole.ADMIN && user.isActive) {
        await this.asegurarOtroAdministrador(tx, id);
      }

      const desactivado = await tx.user.update({
        where: { id },
        data: {
          isActive: false,
        },
        select: USER_PUBLIC_SELECT,
      });

      await this.revocarSesiones(tx, id);
      return desactivado;
    });
  }

  /**
   * Cierra TODAS las sesiones de un usuario sin cambiarle nada más.
   *
   * Para el caso "dejó la sesión abierta en la caja 2" o "creo que alguien
   * vio su contraseña": el administrador lo saca de todos lados de inmediato
   * (en el siguiente refresco, a lo más 15 minutos con el access token actual).
   */
  async revokeUserSessions(id: number, actorId: number) {
    if (id === actorId) {
      throw new BadRequestException(
        'Para cerrar tus propias sesiones usa Mi cuenta › Cerrar sesión en todos los dispositivos.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no existente');
    }

    const res = await this.prisma.userToken.updateMany({
      where: { userId: id, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });

    this.logger.log(
      `event=sessions.revoked_by_admin userId=${id} actorId=${actorId} sesiones=${res.count}`,
    );
    return { revoked: res.count };
  }

  /**
   * Regla "siempre queda al menos un administrador activo".
   *
   * Serializada con un bloqueo consultivo: sin él, dos administradores que se
   * quitan el rol MUTUAMENTE a la vez verían cada uno "queda otro" y ambos
   * pasarían, dejando cero.
   */
  private async asegurarOtroAdministrador(
    tx: Prisma.TransactionClient,
    excluirId: number,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_ADMINISTRADORES}::int, 0)`;
    const otros = await tx.user.count({
      where: { role: UserRole.ADMIN, isActive: true, id: { not: excluirId } },
    });
    if (otros === 0) {
      throw new ConflictException(
        'Debe quedar al menos un administrador activo. Nombra a otro administrador antes de quitarle el rol o darlo de baja.',
      );
    }
  }

  /**
   * Agrega el resumen de sesiones a una página de usuarios. UNA consulta
   * agrupada para toda la página, no una por usuario.
   */
  private async withSessionInfo<T extends { id: number }>(
    users: T[],
  ): Promise<(T & { sessions: UserSessionInfo })[]> {
    if (users.length === 0) return [];

    const grupos = await this.prisma.userToken.groupBy({
      by: ['userId'],
      where: {
        userId: { in: users.map((u) => u.id) },
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      _count: { _all: true },
      _max: { lastUsedAt: true, createdAt: true },
    });

    const porUsuario = new Map(grupos.map((g) => [g.userId, g]));
    return users.map((u) => {
      const g = porUsuario.get(u.id);
      const candidatos = [g?._max.lastUsedAt, g?._max.createdAt].filter(
        (d): d is Date => d instanceof Date,
      );
      const lastSeenAt =
        candidatos.length > 0
          ? new Date(Math.max(...candidatos.map((d) => d.getTime())))
          : null;
      return {
        ...u,
        sessions: { active: g?._count._all ?? 0, lastSeenAt },
      };
    });
  }
}

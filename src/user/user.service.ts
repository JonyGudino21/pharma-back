import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { EditUserDto } from './dto/edit-user.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { USER_PUBLIC_SELECT } from './user.select';
import { Prisma } from '@prisma/client';
import { BCRYPT_ROUNDS } from 'src/common/utils/password.util';
import {
  buildPaginationMeta,
  resolvePagination,
} from 'src/common/utils/pagination.util';

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
      users: users,
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
      searchConditions.push({
        userName: { contains: userName, mode: 'insensitive' },
      });
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
      users,
      pagination: buildPaginationMeta(total, paginacion),
    };
  }

  /**
   * Editar un usuario
   * @param data Dto de EditUser
   */
  async editUser(id: number, data: EditUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException('Usuario no existente');
    }

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
  async deleteUser(id: number) {
    //Validar que el usuario exista
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException('Usuario no existente');
    }

    // Dar de baja cierra sus sesiones en el mismo movimiento. Si no, el usuario
    // despedido seguía pudiendo renovar su sesión hasta que el refresh token
    // caducara por su cuenta.
    return await this.prisma.$transaction(async (tx) => {
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
}

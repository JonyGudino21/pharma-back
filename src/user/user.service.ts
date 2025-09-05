import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { EditUserDto } from './dto/edit-user.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

@Injectable()
export class UserService {
	private readonly logger = new Logger(UserService.name);

  constructor(private prisma: PrismaService){}

	/**
	 * Crea un nuevo usuario
	 * @param data Dto de CreateUserDto
	 * @returns  El usuario creado
	 */
  async createUser(data: CreateUserDto){
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(data.password, salt);

    return this.prisma.user.create({
      data:{
        firstName: data.firstName,
        lastName: data.lastName,
        userName: data.userName,
        email: data.email,
        password: hashedPassword,
        role: data.role
      }
    })
	}

	/**
	 * Obtiene todos los usuarios
	 * @param active Si es true, solo obtiene los usuarios activos. Si es false, solo los inactivos. Si es undefined, obtiene todos.
	 * @param pagination Parametros de paginacion (opcional)
	 * @returns  Lista de usuarios
	 */
	async getAllUsers(active?: boolean, pagination?: PaginationParamsDto) {
		const hasPagination = pagination && 
                       (pagination.page !== undefined || pagination.limit !== undefined);
  
    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

		let whereClause = {};
		if (active === true) {
			whereClause = { isActive: true };
		} else if (active === false) {
			whereClause = { isActive: false };
		}

		// Si NO hay paginación, devolver todos sin paginar
		if (!hasPagination) {
			const users = await this.prisma.user.findMany({
				where: whereClause,
				orderBy: { userName: 'desc' }
			});
			return { users: users };
		}

		const [users, total] = await Promise.all([
			this.prisma.user.findMany({
				where: whereClause,
				skip: skip,
				take: limit,
				orderBy: { userName: 'desc' }
			}),
			this.prisma.user.count({ where: whereClause})
		])

		return {
			users: users,
			pagination:{
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit)
			}
		}
	}

	/**
	 * Obtiene un usuario por ID
	 * @param id Id del usuario
	 * @returns El usaurio encontrado o null si no existe
	 */
	async getUserById(id: number) {
		const user = await this.prisma.user.findUnique({
			where: {id},
			select: {
				id: true,
				email: true,
				userName: true,
				firstName: true,
				lastName: true,
				role: true,
				isActive: true,
				createdAt: true,
				updatedAt: true,
				password: false
			}
		})
		if(!user){
			throw new NotFoundException('Usuario no existente')
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
	async findUser(email?: string, userName?: string, active?: boolean, pagination?: PaginationParamsDto) {
		const hasPagination = pagination && (pagination.page !== undefined || pagination.limit !== undefined);
		const page = hasPagination ? pagination?.page ?? 1 : 1;
		const limit = hasPagination ? pagination?.limit ?? 20 : 20;
		const skip = (page - 1) * limit;

		// 1. Condiciones de BÚSQUEDA (OR) - texto
		const searchConditions: Array<any> = [];
		
		if (email) {
			searchConditions.push({ email: { contains: email, mode: 'insensitive' } });
		}
		if (userName) {
			searchConditions.push({ userName: { contains: userName, mode: 'insensitive' } });
		}

		// 2. Condiciones de FILTRO (AND) - booleanos, exactos
		const filterConditions: any = {};
		
		if (active !== undefined) {
			filterConditions.isActive = { equals: active };
		}

		// 3. Combinar condiciones: (búsqueda OR) AND (filtros)
		const where: any = { ...filterConditions };
		
		if (searchConditions.length > 0) {
			where.OR = searchConditions;
		}

		// Si no hay condiciones, where será un objeto vacío {}
		console.log('Where clause:', JSON.stringify(where, null, 2));

		// Si NO hay paginación, devolver todos sin paginar
		if (!hasPagination) {
			const users = await this.prisma.user.findMany({
				where,
				orderBy: { userName: 'desc' }
			});
			return { users };
		}

		// CON paginación
		const [users, total] = await Promise.all([
			this.prisma.user.findMany({
				where,
				skip: skip,
				take: limit,
				orderBy: { userName: 'desc' }  
			}),
			this.prisma.user.count({ where })
		]);

		return {
			users,
			pagination: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit)
			}
		};
	}

	/**
	 * Editar un usuario
	 * @param data Dto de EditUser
	 */
	async editUser(id: number, data: EditUserDto){
		const user = await this.prisma.user.findUnique({
			where: { id }
		})
		if(!user){
			throw new NotFoundException('Usuario no existente');
		}

		//Validar password
		let hashedPassword: string | undefined = undefined;
		if (data.password) {
			 const salt = await bcrypt.genSalt(10);
			 hashedPassword = await bcrypt.hash(data.password, salt);
		}

		return await this.prisma.user.update({
			where: { id },
			data: {
				firstName: data.firstName,
				lastName: data.lastName,
				userName: data.userName,
				email: data.email,
				role: data.role,
				isActive: data.isActive,
				password: hashedPassword ? hashedPassword : undefined
			}
		})
	}

	/**
	 * Eliminar un usuario
	 * @param id Id del usuario a eliminar
	 */
	async deleteUser(id: number){
		//Validar que el usuario exista
		const user = await this.prisma.user.findUnique({
			where: {id}
		})
		if (!user) {
			throw new NotFoundException('Usuario no existente');
		}

		return await this.prisma.user.update({
			where: { id },
			data: {
				isActive: false
			}
		})
	}
}


import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { EditUserDto } from './dto/edit-user.dto';

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
	 * @returns  Lista de usuarios
	 */
	async getAllUsers(active?: boolean) {
		let whereClause = {};

		if (active === true) {
			whereClause = { isActive: true };
		} else if (active === false) {
			whereClause = { isActive: false };
		}

		return this.prisma.user.findMany({
			where: whereClause,
		});
	}

	/**
	 * Busca un usuario por su ID o email o username
	 * @param id 
	 * @param email 
	 * @param userName 
	 * @returns el usuario encontrado o null si no existe
	 */
	async findUser(id?: number, email?: string, userName?: string) {
		const res = this.prisma.user.findFirst({
			where: {
				OR: [
					{ id: id },
					{ email },
					{ userName }
				]
			},
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

		return res;
	}

	/**
	 * Editar un usuario
	 * @param data Dto de EditUser
	 */
	async editUser(data: EditUserDto){
		return await this.prisma.user.update({
			where: { id: data.id },
			data: {
				firstName: data.firstName,
				lastName: data.lastName,
				userName: data.userName,
				email: data.email,
				role: data.role,
				isActive: data.isActive
			}
		})
	}

	/**
	 * Eliminar un usuario
	 * @param id Id del usuario a eliminar
	 */
	async deleteUser(id: number){
		return await this.prisma.user.update({
			where: { id },
			data: {
				isActive: false
			}
		})
	}
}


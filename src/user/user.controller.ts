import { Controller, Get, Post, Body, Query, Logger, Delete, Patch, Param } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { EditUserDto } from './dto/edit-user.dto';
import { ApiResponse } from '../common/dto/response.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private userService: UserService){}

  @Get()
  async getAllUsers(
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
) {
    // Convertir el parámetro `active` a un booleano o undefined
    let isActive: boolean | undefined;
    if (active === 'true') {
      isActive = true;
    } else if (active === 'false') {
      isActive = false;
    }

    // Convertir paginación manualmente
    const pagination: PaginationParamsDto = {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined
    };

    const res = await this.userService.getAllUsers(isActive, pagination);
    return ApiResponse.ok(res, 'Usuarios encontrados exitosamente');
  }

  @Get('search')
  async findUser(
    @Query('email') email ?: string, 
    @Query('userName') userName ?: string,
    @Query('isActive') isActive ?: string,
    @Query('page') page ?: string, 
    @Query('limit') limit ?: string
) {
    //Convertir el parametro isActive a booleano o undefined
    let active : boolean | undefined;
    if (isActive === 'true') {
        active = true;
    } else if (isActive === 'false') {
        active = false;
    }
    const pagination: PaginationParamsDto = {
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined
    };

    const res = await this.userService.findUser(email, userName, active, pagination);
    return ApiResponse.ok(res, 'Usuario encontrado exitosamente');
  }

  @Get(':id')
  async getUserById(@Param ('id') id: number){
    const res = await this.userService.getUserById(id);
    return ApiResponse.ok(res, 'Usuario encontrado exitosamente');
  }

  @Post()
  async createUser(@Body() data: CreateUserDto){
    const res = await this.userService.createUser(data);
    return ApiResponse.ok(res, 'Usuario creado exitosamente');
  }

  @Patch(':id')
  async editUser(@Param('id') id: number, @Body() data: EditUserDto){
    const res = await this.userService.editUser(id, data);
    return ApiResponse.ok(res, 'Usuario actualizado exitosamente');
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: number){
    const res = await this.userService.deleteUser(id);
    return ApiResponse.ok(res, 'Usuario eliminado exitosamente');
  }
}

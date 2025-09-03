import { Controller, Get, Post, Body, Query, Logger, Delete, Patch } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { EditUserDto } from './dto/edit-user.dto';
import { ApiResponse } from '../common/dto/response.dto';

@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private userService: UserService){}

  @Get()
  async getAllUsers(@Query('active') active?: string) {
    try {
      // Convertir el parámetro `active` a un booleano o undefined
      let isActive: boolean | undefined;
      if (active === 'true') {
        isActive = true;
      } else if (active === 'false') {
        isActive = false;
      }

      const res = await this.userService.getAllUsers(isActive);
      return ApiResponse.ok(res, 'Users retrieved successfully');
    } catch (error) {
      this.logger.error(error);
      return ApiResponse.error('Failed to retrieve users', error);
    }
  }

  @Get('search')
  async findUser(@Query('id') id?: number, @Query('email') email ?: string, @Query('userName') userName ?: string){
    try{
      const idNumber = id ? Number(id) : undefined;
      const res = await this.userService.findUser(idNumber, email, userName);
      return ApiResponse.ok(res, 'User retrieved successfully');
    }catch (error){
      this.logger.error(error);
      return ApiResponse.error('Failed to retrieve user', error);
    }
  }

  @Post()
  async createUser(@Body() data: CreateUserDto){
    try{
      const res = await this.userService.createUser(data);
      return ApiResponse.ok(res, 'User created successfully');
    }catch (error){
      this.logger.error(error);
      return ApiResponse.error('Failed to create user', error);
    }
  }

  @Patch('edit')
  async editUser(@Body() data: EditUserDto){
    try{
      const res = await this.userService.editUser(data);
      return ApiResponse.ok(res, 'User updated successfully');
    }catch (error){
      this.logger.error(error);
      return ApiResponse.error('Failed to update user', error);
    }
  }

  @Delete('delete')
  async deleteUser(@Body('id') id: number){
    try{
      const res = await this.userService.deleteUser(id);
      return ApiResponse.ok(res, 'User deleted successfully');
    }catch(error){
      this.logger.error(error);
      return ApiResponse.error('Failed to delete user', error);
    }
  }
}

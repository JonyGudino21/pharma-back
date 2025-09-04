import { Injectable, Logger } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PrismaService } from 'prisma/prisma.service';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

@Injectable()
export class ClientService {
  private readonly logger = new Logger(ClientService.name);

  constructor (private prisma: PrismaService){}

  /**
   * Crea un nuevo cliente.
   * @param createClientDto los datos del cliente a crear
   * @returns el cliente creado
   */
  async create(createClientDto: CreateClientDto) {
    const res = await this.prisma.client.create({
      data:{
        name: createClientDto.name ?? '',
        email: createClientDto.email,
        phone: createClientDto.phone,
        address: createClientDto.address,
        rfc: createClientDto.rfc,
        curp: createClientDto.curp
      }
    });

    return res;
  }

  /**
   * Encuentra todos los clientes.
   * @param active si es true, solo se devuelven los clientes activos, si es false, solo los inactivos, si no devuelve todos
   * @returns 
   */
  async findAll(active?: boolean, pagination?: PaginationParamsDto) {
    // Verificar si realmente vienen parámetros de paginación en el query
    const hasPagination = pagination && 
                       (pagination.page !== undefined || pagination.limit !== undefined);
  
    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    let whereClause = {};
    if(active === true){
      whereClause = { isActive: true };
    } else if(active === false){
      whereClause = { isActive: false };
    }

    // Si NO hay paginación, devolver todos sin paginar
    if (!hasPagination) {
      const data = await this.prisma.client.findMany({
        where: whereClause,
        orderBy: { name: 'asc' }
      });
      return {clients: data};
    }

    const [ data, total ] = await Promise.all([
      this.prisma.client.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { name: 'asc' }
      }),
      this.prisma.client.count({ where: whereClause})
    ])

    return {
      clients: data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Encuentra un cliente por su ID.
   * @param id el ID del cliente a buscar
   * @returns el cliente encontrado o null si no existe
   */
  async findOne(id: number) {
    const client = await this.prisma.client.findUnique({
      where: {id}
    })
    if(!client) {
      throw new HttpException('Cliente no encontrado', HttpStatus.NOT_FOUND);
    }

    return await this.prisma.client.findUnique({
      where: { id }
    });
  }

  /**
   * Actualiza un cliente por su ID.
   * @param id el ID del cliente a actualizar
   * @param updateClientDto los nuevos datos del cliente
   * @returns el cliente actualizado
   */
  async update(id: number, updateClientDto: UpdateClientDto) {
    //Validar que el cliente exista
    const client = await this.prisma.client.findUnique({
      where: {id}
    });
    if(!client){
      throw new HttpException('Cliente no encontrado', HttpStatus.NOT_FOUND);
    }
    return await this.prisma.client.update({
      where: {id},
      data: {
        name: updateClientDto.name,
        email: updateClientDto.email,
        phone: updateClientDto.phone,
        address: updateClientDto.address,
        rfc: updateClientDto.rfc,
        curp: updateClientDto.curp,
        isActive: updateClientDto.isActive
      }
    })
  }

  /**
   * Eliminar un cliente por su Id
   * @param id el Id del cliente a eliminar
   * @returns el cliente eliminado o null si no existe
   */
  async remove(id: number) {
    return await this.prisma.client.update({
      where: { id },
      data: { isActive: false}
    });
  }

  /**
   * Buscar un cliente por nombre o email o telefono, y devuelve todos los que coincidan
   * @param name el nombre del cliente a buscar
   * @param email el email del cliente a buscar
   * @param phone el telefono del cliente a buscar
   * @returns el o los clientes encontrados o null si no existe
   */
  async findClient(name?: string, email?: string, phone?: string, pagination?: PaginationParamsDto) {
    // Verificar si realmente vienen parámetros de paginación en el query
    const hasPagination = pagination && 
                       (pagination.page !== undefined || pagination.limit !== undefined);
  
    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    const conditions: Array<{ [key: string]: { contains: string; mode: 'insensitive' } }> = [];

    if (name) {
      conditions.push({ 
        name: { contains: name, mode: 'insensitive' } 
      });
    }
    
    if (email) {
      conditions.push({ 
        email: { contains: email, mode: 'insensitive' } 
      });
    }
    
    if (phone) {
      conditions.push({ 
        phone: { contains: phone, mode: 'insensitive' } 
      });
    }

    const where = conditions.length > 0 ? { OR: conditions } : {};

    // Si NO hay paginación, devolver todos sin paginar
    if (!hasPagination) {
      const clients = await this.prisma.client.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      return { clients };
    }

    // CON paginación
    const [clients, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.count({ where })
    ]);

    return {
      clients, // ← Mismo nombre de propiedad que findAll
      pagination: {
        total,
        page, 
        limit,
        totalPages: Math.ceil(total / limit),
      }
    };
  }
}

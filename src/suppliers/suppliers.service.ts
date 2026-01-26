import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { PrismaService } from 'prisma/prisma.service';
import { SearchSupplierDto } from './dto/search-supplier.dto';
import { FindAllSupplierDto } from './dto/findAll-supplier.dto';

@Injectable()
export class SuppliersService {

  constructor(private prisma: PrismaService){}

  /**
   * Crea un nuevo proveedor
   * @param createSupplierDto datos del proveedor a crear
   * @returns el proveedor creado
   */
  async create(createSupplierDto: CreateSupplierDto) {
    return await this.prisma.supplier.create({
      data: createSupplierDto
    })
  }

  /**
   * Obtiene todos los proveedores
   * @param isActive si es true, solo se devuelven los proveedores activos, si es false, solo los inactivos, si no devuelve todos
   * @param pagination parametros de paginacion (opcional)
   * @returns todos los proveedores
   */
  async findAll(findAllSupplierDto: FindAllSupplierDto) {
    const hasPagination = findAllSupplierDto.pagination && (findAllSupplierDto.pagination.page !== undefined || findAllSupplierDto.pagination.limit !== undefined);
    const page = hasPagination ? findAllSupplierDto.pagination?.page ?? 1 : 1;
    const limit = hasPagination ? findAllSupplierDto.pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    let whereClause = {};
    if(findAllSupplierDto.isActive){
      whereClause = { isActive: findAllSupplierDto.isActive };
    }

    // Si no hay paginación, devolver todos sin paginar
    if(!hasPagination){
      const suppliers = await this.prisma.supplier.findMany({
        where: whereClause,
        orderBy: { name: 'asc' }
      })
      return { suppliers };
    }

    // CON paginación
    const [suppliers, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { name: 'asc' }
      }),
      this.prisma.supplier.count({ where: whereClause })
    ])

    return {
      suppliers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Obtiene un proveedor por su id
   * @param id id del proveedor
   * @returns el proveedor encontrado
   */
  async findOne(id: number) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id }
    })
    if(!supplier){
      throw new NotFoundException('Proveedor no encontrado');
    }
    return supplier;
  }

  /**
   * Actualiza un proveedor por su id
   * @param id id del proveedor
   * @param updateSupplierDto datos del proveedor a actualizar
   * @returns el proveedor actualizado
   */
  async update(id: number, updateSupplierDto: UpdateSupplierDto) {
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: updateSupplierDto
    })
    if(!supplier){
      throw new NotFoundException('Proveedor no encontrado');
    }
    return supplier;
  }

  /**
   * Elimina un proveedor por su id
   * @param id id del proveedor
   * @returns el proveedor eliminado
   */
  async remove(id: number) {
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: { isActive: false }
    })
      if(!supplier){
      throw new NotFoundException('Proveedor no encontrado');
    }
    return supplier;
  }

  /**
   * Busca un proveedor por su nombre, email o telefono
   * @param searchSupplierDto datos de busqueda
   * @returns el proveedor encontrado o null si no existe
   */
  async search( searchSupplierDto: SearchSupplierDto ){
    const hasPagination = searchSupplierDto?.pagination && (searchSupplierDto?.pagination?.page !== undefined || searchSupplierDto?.pagination?.limit !== undefined);
    const page = hasPagination ? searchSupplierDto?.pagination?.page ?? 1 : 1;
    const limit = hasPagination ? searchSupplierDto?.pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    const conditions: Array<{ [key: string]: { contains: string; mode: 'insensitive' } }> = [];
    if(searchSupplierDto?.name){
      conditions.push({ name: { contains: searchSupplierDto?.name, mode: 'insensitive' } });
    }
    if(searchSupplierDto?.email){
      conditions.push({ email: { contains: searchSupplierDto?.email, mode: 'insensitive' } });
    }
    if(searchSupplierDto?.phone){
      conditions.push({ phone: { contains: searchSupplierDto?.phone, mode: 'insensitive' } });
    }

    const where = conditions.length > 0 ? { OR: conditions } : {};

    if(!hasPagination){
      const suppliers = await this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' }
      })
      return { suppliers };
    }

    const [suppliers, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' }
      }),
      this.prisma.supplier.count({ where })
    ])

    return {
      suppliers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }
}

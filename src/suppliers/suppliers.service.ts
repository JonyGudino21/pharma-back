import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { PrismaService } from 'prisma/prisma.service';
import { SearchSupplierDto } from './dto/search-supplier.dto';
import { FindAllSupplierDto } from './dto/findAll-supplier.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { PurchaseStatus } from '@prisma/client';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(private prisma: PrismaService){}

  /**
   * Crea un nuevo proveedor
   * - Valida duplicados
   * @param createSupplierDto datos del proveedor a crear
   * @returns el proveedor creado
   */
  async create(dto: CreateSupplierDto) {
    // Validar duplicados
    if(dto.email){
      const exist = await this.prisma.supplier.findUnique({
        where: { email: dto.email }
      });
      if(exist){
        throw new ConflictException(`El proveedor con email ${dto.email} ya existe.`);
      }
    }

    return await this.prisma.supplier.create({
      data: {
        name: dto.name,
        contact: dto.contact,
        phone: dto.phone,
        email: dto.email,
        creditDays: dto.creditDays ?? 0,
      }
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
        orderBy: { name: 'asc' },
        // Incluimos conteo de compras pendientes para visualización rápida
        include:{
          _count: { select: { purchases: { where: { status: { not: 'PAID' } } } } },
        }
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
    // Validar que el proveedor exista
    await this.findOne(id);

    // Si intenta cambiar email, validar que no choque con otro
    if (updateSupplierDto.email) {
      const exists = await this.prisma.supplier.findFirst({
          where: { email: updateSupplierDto.email, id: { not: id } }
      });
      if (exists) throw new ConflictException(`El email ${updateSupplierDto.email} ya está usado por otro proveedor.`);
   }

    return await this.prisma.supplier.update({
      where: { id },
      data: updateSupplierDto
    });
  }

  /**
   * Elimina un proveedor por su id
   * @param id id del proveedor
   * @returns el proveedor eliminado
   */
  async remove(id: number) {
    // Validar que el proveedor exista
    const supplier = await this.findOne(id);

    // Validación Financiera
    if (new Decimal(supplier.balance).gt(0)) {
      throw new BadRequestException(
          `No se puede eliminar al proveedor ${supplier.name} porque tiene un saldo pendiente de pago de $${supplier.balance}. Liquide la deuda primero.`
      );
    }

    // Validar que no tenga compras pendientes
    const purchases = await this.prisma.purchase.findMany({
      where: { supplierId: id, status: { not: 'PAID' } }
    });
    if (purchases.length > 0) {
      throw new BadRequestException(
          `No se puede eliminar al proveedor ${supplier.name} porque tiene compras pendientes.`
      );
    }

    return await this.prisma.supplier.update({
      where: { id },
      data: { isActive: false }
    });
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

  /**
   * Obtiene el estado de cuenta (Facturas por pagar)
   */
  async getAccountStatement(id: number) {
    const supplier = await this.findOne(id);

    // Obtener compras pendientes de pago
    const pendingPurchases = await this.prisma.purchase.findMany({
      where: {
        supplierId: id,
        status: { in: [PurchaseStatus.PENDING, PurchaseStatus.PARTIAL] }
      },
      orderBy: { createdAt: 'asc' }, // Las más viejas primero (Prioridad de pago)
      select: {
        id: true,
        invoiceNumber: true,
        total: true,       // Total de la factura
        paidAmount: true, // Cuánto ya se ha pagado
        balance: true,    // Deuda pendiente
        createdAt: true,
        status: true       // Estado de la factura
      }
    });

    return {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        currentBalance: supplier.balance, // Saldo actual con la empresa
        creditDays: supplier.creditDays
      },
      pendingInvoices: pendingPurchases
    };
}
}

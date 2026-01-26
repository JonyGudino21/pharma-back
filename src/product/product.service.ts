import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PrismaService } from 'prisma/prisma.service';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { NotFoundException } from '@nestjs/common';
import { Product } from '@prisma/client';

@Injectable()
export class ProductService {

  constructor(private prisma: PrismaService){}
  
  /**
   * Crea un nuevo producto
   * @param createProductDto DTO de producto a crear
   * @returns El producto creado
   */
  async create(createProductDto: CreateProductDto, userId: number) {
    // Generar SKU automáticamente
    const sku = await this.generateSKU({
      name: createProductDto.name,
      strength: createProductDto.strength ?? '',
      format: createProductDto.format ?? '', // FIX: Add format to CreateProductDto
    });

    //Verificar unicidad del SKU
    const existingProductBySku = await this.prisma.product.findFirst({
      where: {
        sku
      }
    });
    if(existingProductBySku) {
      throw new BadRequestException(
        `El SKU ya existe en el producto: ${existingProductBySku.name} (ID: ${existingProductBySku.id})`
      );
    }

    //Verificar unicidad del barcode si se proporciona
    if(createProductDto.barcode) {
      const existingProductByBarcode = await this.prisma.product.findFirst({
        where: {
          barcode: createProductDto.barcode
        },
        include: {
          categories: {
            include: { category: true }
          }
        }
      });
      if(existingProductByBarcode) {
        const productInfo = {
          id: existingProductByBarcode.id,
          name: existingProductByBarcode.name,
          sku: existingProductByBarcode.sku,
          barcode: existingProductByBarcode.barcode,
          categories: existingProductByBarcode.categories.map(pc => pc.category.name)
        };
        throw new BadRequestException(
          `El código de barras ya existe en el producto: ${existingProductByBarcode.name} (ID: ${existingProductByBarcode.id}, SKU: ${existingProductByBarcode.sku})`
        );
      }
    }

    //Validar categorias
    if(createProductDto.categories) {
      const categories = await this.prisma.category.findMany({
        where: {
          id: {in: createProductDto.categories}
        }
      });
      if(categories.length !== createProductDto.categories.length) throw new BadRequestException('Alguna categoría no existe');
    }

    const product = await this.prisma.product.create({
      data: {
        name: createProductDto.name,
        description: createProductDto.description,
        sku,
        barcode: createProductDto.barcode,
        controlled: createProductDto.controlled ?? false,
        stock: createProductDto.stock ?? 0,
        minStock: createProductDto.minStock ?? 5,
        price: createProductDto.price,
        cost: createProductDto.cost,
        isActive: true,
        categories: createProductDto.categories
          ? {
              create: createProductDto.categories.map((catId) => ({
                category: { connect: { id: catId } },
              })),
            }
          : undefined,
      },
      include: { categories: { include: { category: true } } },
    });
  
    // Registrar historial de precio inicial
    await this.prisma.productPriceHistory.create({
      data: {
        productId: product.id,
        changedById: userId,
        price: product.price,
        startDate: new Date(),
      },
    });
  
    return product;
  }

  async findAll(active?: boolean, pagination?: PaginationParamsDto) {
    //Verificar si tiene parametros de paginacion
    const hasPagination = pagination && (pagination.page !== undefined || pagination.limit !== undefined);
    const page = hasPagination ? pagination.page ?? 1 : 1;
    const limit = hasPagination ? pagination.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    let whereClause = {};
    if(active === true){
      whereClause = { isActive: true };
    } else if(active === false){
      whereClause = { isActive: false };
    }

    //Si no tiene parametros de paginacion, devolver todos sin paginar
    if(!hasPagination){
      const products = await this.prisma.product.findMany({
        where: whereClause,
        orderBy: { name: 'asc' },
        include: { 
          categories: { 
            include: { category: true },
            orderBy: { order: 'asc' }
          } 
        }
      });
      return { products };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: whereClause,
        skip: skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { 
          categories: { 
            include: { category: true },
            orderBy: { order: 'asc' }
          } 
        }
      }),
      this.prisma.product.count({ where: whereClause })
    ]);

    return {
      products,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Encuentra un producto por su ID
   * @param id id del producto abuscar
   * @returns el producto encontrado o error si no existe
   */
  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { 
        categories: { 
          include: { category: true },
          orderBy: { order: 'asc' }
        } 
      }
    });
    
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }
    
    return product;
  }

  /**
   * Actualiza un producto por su ID
   * @param id id del producto a actualizar
   * @param updateProductDto DTO de producto a actualizar
   * @param userId ID del usuario que realiza la actualización
   * @returns el producto actualizado o error si no existe
   */
  async update(id: number, updateProductDto: UpdateProductDto, userId: number) {
    // Validar que el producto existe
    const existingProduct = await this.validateProduct(id);
    
    // Validar categorías si se proporcionan
    if (updateProductDto.categories) {
      const categories = await this.prisma.category.findMany({
        where: {
          id: { in: updateProductDto.categories }
        }
      });
      if (categories.length !== updateProductDto.categories.length) {
        throw new BadRequestException('Alguna categoría no existe');
      }
    }

    // Verificar unicidad del barcode si se proporciona
    if (updateProductDto.barcode) {
      const existingProductByBarcode = await this.prisma.product.findFirst({
        where: {
          barcode: updateProductDto.barcode,
          id: { not: id } // Excluir el producto actual
        },
        include: {
          categories: {
            include: { category: true }
          }
        }
      });
      if (existingProductByBarcode) {
        throw new BadRequestException(
          `El código de barras ya existe en el producto: ${existingProductByBarcode.name} (ID: ${existingProductByBarcode.id}, SKU: ${existingProductByBarcode.sku})`
        );
      }
    }

    // Verificar si el precio cambió para registrar en historial
    const priceChanged = updateProductDto.price && 
      updateProductDto.price.toString() !== existingProduct.price.toString();

    // Verificar si se debe regenerar el SKU
    const shouldRegenerateSKU = updateProductDto.name || 
      updateProductDto.strength !== undefined || 
      updateProductDto.format !== undefined;

    let newSku = existingProduct.sku;
    
    if (shouldRegenerateSKU) {
      // Generar nuevo SKU basado en los datos actualizados
      newSku = await this.generateSKU({
        name: updateProductDto.name ?? existingProduct.name,
        strength: updateProductDto.strength ?? '',
        format: updateProductDto.format ?? ''
      });

      // Verificar que el nuevo SKU no exista (excepto para el producto actual)
      const existingProductWithSku = await this.prisma.product.findFirst({
        where: {
          sku: newSku,
          id: { not: id }
        }
      });
      
      if (existingProductWithSku) {
        throw new BadRequestException(
          `El nuevo SKU generado ya existe en el producto: ${existingProductWithSku.name} (ID: ${existingProductWithSku.id})`
        );
      }
    }

    // Preparar datos de actualización
    const updateData: any = {
      name: updateProductDto.name,
      description: updateProductDto.description,
      sku: newSku, // Incluir el SKU actualizado
      barcode: updateProductDto.barcode,
      controlled: updateProductDto.controlled,
      stock: updateProductDto.stock,
      minStock: updateProductDto.minStock,
      price: updateProductDto.price,
      cost: updateProductDto.cost,
      isActive: updateProductDto.isActive,
    };

    // Manejar actualización de categorías si se proporcionan
    if (updateProductDto.categories !== undefined) {
      updateData.categories = {
        deleteMany: {}, // Eliminar todas las categorías existentes
        create: updateProductDto.categories.map((catId, index) => ({
          categoryId: catId,
          isPrimary: index === 0, // La primera categoría es la principal
          order: index + 1
        }))
      };
    }

    // Actualizar el producto
    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: updateData,
      include: { 
        categories: { 
          include: { category: true },
          orderBy: { order: 'asc' }
        } 
      },
    });

    // Registrar historial de precio si cambió
    if (priceChanged) {
      // Finalizar el historial de precio anterior
      await this.prisma.productPriceHistory.updateMany({
        where: {
          productId: id,
          endDate: null
        },
        data: {
          endDate: new Date()
        }
      });

      // Crear nuevo registro de historial
      await this.prisma.productPriceHistory.create({
        data: {
          productId: id,
          changedById: userId,
          price: updateProductDto.price!,
          startDate: new Date(),
        },
      });
    }

    return updatedProduct;
  }

  /**
   * Elimina un producto por su ID
   * @param id id del producto a eliminar
   * @returns el producto eliminado o error si no existe
   */
  async remove(id: number) {
    await this.validateProduct(id);
    return await this.prisma.product.update({
      where: {id},
      data: {isActive: false}
    });
  }

  /**
   * Buscar un producto por su nombre o por letras iniciales del nombre
   * @param name nombre del producto a buscar
   * @param letters arreglo de letras iniciales del nombre del producto a buscar
   * @param pagination parametros de paginacion (opcional)
   * @returns el producto encontrado o error si no existe
   */
  async search(name: string, letters?: string[], pagination?: PaginationParamsDto) {
    const hasPagination = pagination && (pagination.page !== undefined || pagination.limit !== undefined)
    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    const conditions: Array<{ [key: string]: any }> = [];
    
    if(name) {
      conditions.push({ name: { contains: name, mode: 'insensitive' } });
    }
    
    if(letters && letters.length > 0) {
      const letterConditions = letters.map(letter => ({
        name: { startsWith: letter, mode: 'insensitive' }
      }));
      conditions.push(...letterConditions);
    }

    const where = conditions.length > 0 ? { OR: conditions } : {};

    //Si no tiene parametros de paginacion, devolver todos sin paginar
    if(!hasPagination){
      const products = await this.prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        include: { 
          categories: { 
            include: { category: true },
            orderBy: { order: 'asc' }
          } 
        }
      });
      return { products };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { 
          categories: { 
            include: { category: true },
            orderBy: { order: 'asc' }
          } 
        }
      }),
      this.prisma.product.count({ where })
    ]);

    return {
      products,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Busca un producto por su SKU
   * @param sku SKU del producto a buscar
   * @returns el producto encontrado o error si no existe
   */
  async findBySku(sku: string) {
    const product = await this.prisma.product.findUnique({
      where: {sku},
      include: {
        categories: {
          include: { category: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    if(!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  /**
   * Busca un producto por su barcode
   * @param barcode barcode del producto a buscar
   * @returns el producto encontrado o error si no existe
   */
  async findByBarcode(barcode: string) {
    const product = await this.prisma.product.findUnique({
      where: {barcode},
      include: {
        categories: {
          include: { category: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    if(!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  private async validateProduct(id: number){
    const product = await this.prisma.product.findUnique({
      where: {id}
    })
    if(!product) throw new NotFoundException('Producto no encontrado');

    return product;
  }

  private async generateSKU(productData: {
    name: string;
    strength: string;
    format: string;
  }): Promise<string>{

     // 1. Abreviación del nombre (3 letras)
    const nameCode = this.getNameCode(productData.name);
    
    // 2. Concentración 
    const concentrationCode = productData.strength 
      ? this.formatConcentration(productData.strength)
      : '';
    
    // 3. Formato (opcional)
    const formatCode = productData.format
      ? this.getFormatCode(productData.format)
      : 'GEN'; // General por defecto
    
    // 4. Variante numérica
    const variantCode = await this.getNextVariant(
      nameCode, 
      concentrationCode, 
      formatCode
    );
    
    // Ensamblar SKU
    const parts = [nameCode, concentrationCode, formatCode, variantCode]
      .filter(part => part !== '');
    
    return parts.join('-');
  }

  private getNameCode(productName: string): string{
    // Remover caracteres especiales y espacios
    const cleanName = productName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remover acentos
    .replace(/[^a-zA-Z0-9]/g, '')    // Remover caracteres especiales
    .toUpperCase();

  // Tomar primeras 3 letras significativas
  if (cleanName.length < 4) return cleanName;

  // Para nombres compuestos: mejorar la lógica
  const words = productName.split(' ').filter(word => word.length > 0);
  
  if (words.length > 1) {
    // Palabras comunes que indican variantes (no son el nombre principal)
    const variantWords = ['COMPUESTO', 'COMPUESTA', 'FORTE', 'PLUS', 'MAX', 'EXTRA', 'SUAVE', 'FORTE', 'PEDIATRICO', 'PEDIATRICA', 'ADULTO', 'ADULTA', 'INFANTIL'];
    
    // Separar palabra principal de variantes
    const mainWords = words.filter(word => !variantWords.includes(word.toUpperCase()));
    const variantWords_found = words.filter(word => variantWords.includes(word.toUpperCase()));
    
    if (mainWords.length > 0) {
      let mainCode = '';
      
      if (mainWords.length === 1) {
        // Una sola palabra principal: tomar las primeras 4 letras
        mainCode = mainWords[0].substring(0, 4).toUpperCase();
      } else if (mainWords.length === 2) {
        // Dos palabras principales: tomar 2 letras de cada una
        mainCode = (mainWords[0].substring(0, 2) + mainWords[1].substring(0, 2)).toUpperCase();
      } else {
        // Más de dos palabras principales: tomar primera letra de cada una
        mainCode = mainWords.map(word => word.charAt(0)).join('').substring(0, 4).toUpperCase();
      }
      
      // Si hay variantes, agregar la primera letra de cada variante
      if (variantWords_found.length > 0) {
        const variantCode = variantWords_found.map(word => word.charAt(0)).join('');
        mainCode = (mainCode + variantCode).substring(0, 4);
      }
      
      return mainCode;
    } else {
      // Si todas son variantes, usar la lógica original
      return words.map(word => word.charAt(0)).join('').substring(0, 4);
    }
    //     Identifica palabras principales (no están en variantWords)
    // Aplica estrategia según cantidad:
    // 1 palabra: Primeras 4 letras
    // 2 palabras: 2 letras de cada una
    // 3+ palabras: Primera letra de cada una
  }

  return cleanName.substring(0, 4);
  }

  private formatConcentration(strength: string) : string {
    return strength
      .toUpperCase()
      .replace(/\s+/g, '')    // Remover espacios
      .replace(/[^A-Z0-9]/g, '') // Solo letras y números
      .substring(0, 10);      // Máximo 10 caracteres
  }

  private getFormatCode(format: string): string {
    const formatMap: { [key: string]: string } = {
      // Formas sólidas
      'Tabletas': 'TAB',
      'Cápsulas': 'CAP',
      'Comprimidos': 'COMP',
      'Grageas': 'GRA',
      'Pastillas': 'PAS',
      'Polvo': 'POL',
      'Granulado': 'GRA',
      'Efervescente': 'EFE',
      'Liofilizado': 'LIO',
      'Óvulo': 'OVU',
      'Supositorio': 'SUP',
      'Implante': 'IMP',
      'Parche': 'PAR',
      
      // Formas líquidas
      'Jarabe': 'JAR',
      'Suspensión': 'SUS',
      'Emulsión': 'EMU',
      'Gotas': 'GOT',
      'Elixir': 'ELI',
      'Tintura': 'TIN',
      'Solución': 'SOL',
      'Inyectable': 'INY',
      'Infusión': 'INF',
      'Colirio': 'COL',
      'Nebulizador': 'NEB',
      'Spray': 'SPR',
      'Aerosol': 'AER',
      'Linimento': 'LIN',
      
      // Formas semisólidas
      'Crema': 'CRE',
      'Pomada': 'POM',
      'Gel': 'GEL',
      'Ungüento': 'UNG',
      'Pasta': 'PAS',
      'Emplasto': 'EMP',
      'Shampoo': 'SHA',
      'Jabón': 'JAB',
      'Loción': 'LOC',
      
      // Formas especiales
      'Inhalador': 'INH',
      'Nebulización': 'NEB',
      'Cápsula blanda': 'CAPB',
      'Cápsula dura': 'CAPD',
      'Tableta masticable': 'TABM',
      'Tableta sublingual': 'TABS',
      'Tableta de liberación prolongada': 'TABLP',
      'Comprimido bucal': 'COMPB',
      
      // Dispositivos médicos
      'Kit': 'KIT',
      'Paquete': 'PAQ',
      'Dispositivo': 'DIS',
      'Sistema': 'SIS',
      
      // Misceláneos
      'Gas': 'GAS',
      'General': 'GEN',
      'Óptico': 'OPT',
      'Ótico': 'OTO',
      'Nasal': 'NAS',
      'Bucal': 'BUC',
      'Dental': 'DEN',
      'Rectal': 'REC',
      'Vaginal': 'VAG'
    };
    
    return formatMap[format] || format.substring(0, 3).toUpperCase();
  }

  private async getNextVariant(
    nameCode: string, 
    concentrationCode: string, 
    formatCode: string
  ): Promise<string> {
    const basePattern = `${nameCode}-${concentrationCode}-${formatCode}`;
    
    const existingProducts = await this.prisma.product.findMany({
      where: {
        sku: {
          startsWith: basePattern
        }
      },
      orderBy: {
        sku: 'desc'
      },
      take: 1
    });
    
    if (existingProducts.length === 0) {
      return '01';
    }
    
    const lastSKU = existingProducts[0].sku;
    const lastVariant = lastSKU.split('-').pop() || '00';
    const nextVariant = parseInt(lastVariant) + 1;
    
    return nextVariant.toString().padStart(2, '0');
  }
}

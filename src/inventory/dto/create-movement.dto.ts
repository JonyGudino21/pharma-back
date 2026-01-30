import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { MovementType } from '@prisma/client';

export class CreateInventoryMovementDto {
  @IsInt()
  @IsNotEmpty()
  productId: number;

  @IsEnum(MovementType)
  type: MovementType;

  @IsInt()
  // Validamos que la cantidad no sea 0. Puede ser negativa o positiva dependiendo del tipo,
  // pero aquí pediremos siempre positivo (valor absoluto) y el servicio decide el signo, 
  // O pedimos el signo explícito.
  // MEJOR PRÁCTICA: Pedir siempre positivo (magnitud) y que el TIPO defina si suma o resta.
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  quantity: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsInt()
  referenceId?: number; // ID de la venta o compra si aplica
}
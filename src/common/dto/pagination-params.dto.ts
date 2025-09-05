import { IsOptional, IsNumber, Min, Max } from "class-validator";
import { Type } from "class-transformer";

export class PaginationParamsDto{

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Type(() => Number)
    page?: number;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(100)
    @Type(() => Number)
    limit?: number;
}
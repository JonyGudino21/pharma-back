import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { isSettingsNamespace, type SettingsNamespace } from './definitions';

/** `:namespace` de la URL → sección conocida, o 404. */
@Injectable()
export class SettingsNamespacePipe
  implements PipeTransform<string, SettingsNamespace>
{
  transform(value: string): SettingsNamespace {
    if (!isSettingsNamespace(value)) {
      throw new NotFoundException('Sección de configuración desconocida.');
    }
    return value;
  }
}

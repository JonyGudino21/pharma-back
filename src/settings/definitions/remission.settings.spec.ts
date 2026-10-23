import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  DEFAULT_REMISSION_LEGEND,
  REMISSION_SETTINGS,
  RemissionSettings,
} from './remission.settings';

const errores = (valores: object) =>
  validateSync(plainToInstance(RemissionSettings, valores)).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('Configuración › Nota de remisión', () => {
  const defaults = REMISSION_SETTINGS.defaults(undefined as never);

  it('los valores de fábrica son válidos', () => {
    expect(errores(defaults)).toEqual([]);
  });

  it('de fábrica la leyenda aclara que no es un CFDI', () => {
    expect(defaults.legend).toBe(DEFAULT_REMISSION_LEGEND);
    expect(defaults.legend).toMatch(/no es un CFDI/i);
  });

  it('de fábrica: Carta, activada, con firmas y pagos, sin desglose de IVA', () => {
    expect(defaults).toMatchObject({
      enabled: true,
      paper: 'LETTER',
      showSignatures: true,
      showPayments: true,
      showTaxBreakdown: false,
    });
  });

  it('código, lote y caducidad se muestran de fábrica (no cambia lo ya impreso)', () => {
    expect(defaults).toMatchObject({
      showSku: true,
      showLot: true,
      showExpiry: true,
    });
    expect(errores({ ...defaults, showExpiry: 'no' })).toHaveLength(1);
    expect(errores({ ...defaults, showLot: false, showExpiry: false })).toEqual(
      [],
    );
  });

  it('datos de la farmacia: todos se imprimen de fábrica', () => {
    expect(defaults).toMatchObject({
      showLogo: true,
      showLegalName: true,
      showRfc: true,
      showFiscalRegime: true,
      showAddress: true,
      showPhone: true,
      showEmail: true,
    });
  });

  it('datos de la farmacia: cada uno se puede apagar y sólo acepta sí o no', () => {
    const apagados = {
      showLogo: false,
      showLegalName: false,
      showRfc: false,
      showFiscalRegime: false,
      showAddress: false,
      showPhone: false,
      showEmail: false,
    };
    expect(errores({ ...defaults, ...apagados })).toEqual([]);
    expect(errores({ ...defaults, showFiscalRegime: 'si' })).toContain(
      'Mostrar el régimen fiscal debe ser sí o no.',
    );
    expect(errores({ ...defaults, showLogo: 1 })).toContain(
      'Mostrar el logo debe ser sí o no.',
    );
  });

  it('una sección guardada antes de estos ajustes se completa con los de fábrica', () => {
    // Lo que hace SettingsService.materialize: { ...defaults, ...guardado }.
    const guardadoAntes: Partial<RemissionSettings> = {
      enabled: true,
      paper: 'A4',
      legend: DEFAULT_REMISSION_LEGEND,
      terms: '',
      showSignatures: false,
      showPayments: true,
      showSku: true,
      showLot: true,
      showExpiry: true,
      showTaxBreakdown: false,
      density: 'AUTO',
    };
    const efectivo = { ...defaults, ...guardadoAntes };
    expect(errores(efectivo)).toEqual([]);
    expect(efectivo).toMatchObject({
      paper: 'A4',
      showSignatures: false,
      showLogo: true,
      showRfc: true,
      showEmail: true,
    });
  });

  it('densidad: automática de fábrica; sólo valores conocidos', () => {
    expect(defaults.density).toBe('AUTO');
    expect(errores({ ...defaults, density: 'COMPACT' })).toEqual([]);
    expect(errores({ ...defaults, density: 'MINI' })).toContain(
      'La densidad debe ser Automática, Cómoda o Compacta.',
    );
  });

  it('rechaza un tamaño de hoja desconocido', () => {
    expect(errores({ ...defaults, paper: 'LEGAL' })).toContain(
      'El tamaño de hoja debe ser Carta o A4.',
    );
  });

  it('rechaza una leyenda o condiciones que desbordarían la hoja', () => {
    expect(errores({ ...defaults, legend: 'x'.repeat(301) })).toHaveLength(1);
    expect(errores({ ...defaults, terms: 'x'.repeat(601) })).toHaveLength(1);
    expect(errores({ ...defaults, terms: 'x'.repeat(600) })).toEqual([]);
  });

  it('acepta condiciones vacías (no se imprimen)', () => {
    expect(errores({ ...defaults, terms: '' })).toEqual([]);
  });

  it('rechaza un booleano que no es booleano', () => {
    expect(errores({ ...defaults, enabled: 'si' })).toHaveLength(1);
  });
});

import { CASH_SETTINGS, CashSettings } from './cash.settings';
import { DISCOUNT_SETTINGS, DiscountSettings } from './discounts.settings';
import { INVENTORY_SETTINGS, InventorySettings } from './inventory.settings';
import { PRICING_SETTINGS, PricingSettings } from './pricing.settings';
import { REMISSION_SETTINGS, RemissionSettings } from './remission.settings';
import { TAX_SETTINGS, TaxSettings } from './taxes.settings';
import type { SettingsDefinition } from './settings-definition';

/** Tipo de los valores de cada sección. */
export interface SettingsMap {
  inventory: InventorySettings;
  cash: CashSettings;
  discounts: DiscountSettings;
  taxes: TaxSettings;
  remission: RemissionSettings;
  pricing: PricingSettings;
}

export type SettingsNamespace = keyof SettingsMap;

/** Catálogo de secciones. Una sección nueva se registra aquí y en `SettingsMap`. */
export const SETTINGS_REGISTRY: {
  [N in SettingsNamespace]: SettingsDefinition<SettingsMap[N]>;
} = {
  inventory: INVENTORY_SETTINGS,
  cash: CASH_SETTINGS,
  discounts: DISCOUNT_SETTINGS,
  taxes: TAX_SETTINGS,
  remission: REMISSION_SETTINGS,
  pricing: PRICING_SETTINGS,
};

export const SETTINGS_NAMESPACES = Object.keys(
  SETTINGS_REGISTRY,
) as SettingsNamespace[];

export function isSettingsNamespace(value: string): value is SettingsNamespace {
  return (SETTINGS_NAMESPACES as string[]).includes(value);
}

export {
  CashSettings,
  DiscountSettings,
  InventorySettings,
  PricingSettings,
  RemissionSettings,
  TaxSettings,
};

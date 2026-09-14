/**
 * What a site can configure about itself, as a shape rather than a bag.
 *
 * `Organization.settings` is a JSON blob in a String column. That is fine as
 * storage and useless as a contract: the console writes four flat keys, the
 * mobile app needs sixteen grouped ones, and nothing validates either. So the
 * blob stays, and this file becomes the only thing that reads or writes it.
 *
 * Two rules hold the whole design together:
 *
 *   1. **A read always returns a complete object.** Callers get defaults deep-
 *      merged with what is stored, so a screen never branches on "did the site
 *      ever set a currency".
 *   2. **A write never drops what it did not send.** `PUT` replaces the column
 *      wholesale, so a phone saving the theme would otherwise wipe the working
 *      hours a receptionist set on the web an hour earlier.
 */

// ── Vocabularies ─────────────────────────────────────────────────────────────
//
// These mirror the mobile app: the presets are the ids in
// `medihive/lib/app/theme/brand_palette.dart`, and the fonts are the ten faces
// bundled in its pubspec. A value not on these lists reaches a device that has
// no such asset and silently falls back, which looks like the setting did not
// save.

export const THEME_PRESETS = [
  'default',
  'clinicalTeal',
  'clinicalBlue',
  'forest',
  'plum',
  'custom',
] as const;

export const THEME_FONTS = [
  'inter',
  'montserrat',
  'poppins',
  'roboto',
  'openSans',
  'lato',
  'nunito',
  'workSans',
  'dmSans',
  'manrope',
] as const;

export const TRIAGE_SCALES = ['p1-p5', 'esi', 'mts', 'colour'] as const;

export const DATE_FORMATS = [
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd',
  'dd MMM yyyy',
] as const;

export const CALENDARS = ['gregorian', 'ethiopian'] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];
export type ThemeFont = (typeof THEME_FONTS)[number];
export type TriageScale = (typeof TRIAGE_SCALES)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];
export type CalendarSystem = (typeof CALENDARS)[number];

// ── The resolved shape ───────────────────────────────────────────────────────

export interface LocaleSettings {
  currency: string;
  currencySymbol: string;
  currencyPosition: 'before' | 'after';
  decimalSeparator: string;
  thousandSeparator: string;
  centPrecision: number;
  showZeroCents: boolean;
  language: string;
  timezone: string;
  dateFormat: DateFormat;
  use24HourClock: boolean;
  calendar: CalendarSystem;
}

export interface CustomColors {
  primary: string;
  secondary?: string;
  accent?: string;
}

export interface AppearanceSettings {
  themePreset: ThemePreset;
  themeFont: ThemeFont;
  customColors: CustomColors | null;
}

export interface ClinicalSettings {
  /** Minutes a patient may wait before the queue board flags it. 0 = off. */
  waitBreachMinutes: number;
  triageScale: TriageScale;
  /** Off where a board is visible from a waiting area. */
  showPatientNames: boolean;
  /** Idle minutes before a shared device locks. 0 = never. */
  sessionLockMinutes: number;
}

export interface WorkingHours {
  start: string;
  end: string;
}

export interface SchedulingSettings {
  workingHours: WorkingHours;
  appointmentDuration: number;
}

export interface OrganizationSettings {
  locale: LocaleSettings;
  appearance: AppearanceSettings;
  clinical: ClinicalSettings;
  scheduling: SchedulingSettings;
}

/**
 * The defaults a site that has never been configured runs on.
 *
 * India-first, because that is where the first deployments are. Nothing here is
 * hard-coded anywhere else: change the row and every screen follows.
 */
export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  locale: {
    currency: 'INR',
    currencySymbol: '₹',
    currencyPosition: 'before',
    decimalSeparator: '.',
    thousandSeparator: ',',
    centPrecision: 2,
    showZeroCents: false,
    language: 'en',
    timezone: 'Asia/Kolkata',
    dateFormat: 'dd/MM/yyyy',
    use24HourClock: true,
    calendar: 'gregorian',
  },
  appearance: {
    themePreset: 'default',
    themeFont: 'montserrat',
    customColors: null,
  },
  clinical: {
    waitBreachMinutes: 30,
    triageScale: 'p1-p5',
    showPatientNames: true,
    sessionLockMinutes: 5,
  },
  scheduling: {
    workingHours: { start: '08:00', end: '17:00' },
    appointmentDuration: 30,
  },
};

/** Symbols for the currencies the settings UI offers. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  ETB: 'Br',
  KES: 'KSh',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function currencySymbolFor(code: string): string {
  return CURRENCY_SYMBOLS[code?.toUpperCase()] ?? code;
}

// ── Reading ──────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickNonEmpty(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/**
 * Lifts the console's flat keys into the grouped shape.
 *
 * The web console writes `{currency, language, timezone, workingHours,
 * appointmentDuration}` at the top level, and its Organization tab reads
 * `defaultCurrency` / `defaultTimezone` / `defaultLanguage` / `defaultCalendar`
 * — keys nothing has ever written. Both spellings are accepted here so an
 * organisation row written before this change still resolves, and so the
 * console keeps working while it is migrated.
 */
function liftLegacyKeys(
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const locale = asRecord(stored.locale);
  const scheduling = asRecord(stored.scheduling);

  const legacyLocale: Record<string, unknown> = {
    currency: stored.currency ?? stored.defaultCurrency,
    language: stored.language ?? stored.defaultLanguage,
    timezone: stored.timezone ?? stored.defaultTimezone,
    calendar: stored.calendar ?? stored.defaultCalendar,
  };

  for (const [key, value] of Object.entries(legacyLocale)) {
    if (value !== undefined && locale[key] === undefined) {
      locale[key] = value;
    }
  }

  const legacyScheduling: Record<string, unknown> = {
    workingHours: stored.workingHours,
    appointmentDuration: stored.appointmentDuration,
  };

  for (const [key, value] of Object.entries(legacyScheduling)) {
    if (value !== undefined && scheduling[key] === undefined) {
      scheduling[key] = value;
    }
  }

  return { ...stored, locale, scheduling };
}

/**
 * Stored JSON → a complete, valid settings object.
 *
 * Every field is validated against its vocabulary on the way out, not only on
 * the way in: rows predating this file were written by an `@IsObject()` DTO
 * that accepted anything, and a screen that trusts an unvalidated `themeFont`
 * renders in a face nobody bundled.
 */
export function resolveOrganizationSettings(
  stored: unknown,
): OrganizationSettings {
  const raw = liftLegacyKeys(
    typeof stored === 'string' ? safeParse(stored) : asRecord(stored),
  );

  const d = DEFAULT_ORGANIZATION_SETTINGS;
  const locale = asRecord(raw.locale);
  const appearance = asRecord(raw.appearance);
  const clinical = asRecord(raw.clinical);
  const scheduling = asRecord(raw.scheduling);
  const workingHours = asRecord(scheduling.workingHours);

  const currency = pickNonEmpty(
    locale.currency,
    d.locale.currency,
  ).toUpperCase();

  const customColors = asRecord(appearance.customColors);
  const primary =
    typeof customColors.primary === 'string' ? customColors.primary : null;

  return {
    locale: {
      currency,
      currencySymbol: pickNonEmpty(
        locale.currencySymbol,
        currencySymbolFor(currency),
      ),
      currencyPosition:
        locale.currencyPosition === 'after'
          ? 'after'
          : d.locale.currencyPosition,
      decimalSeparator: pickNonEmpty(
        locale.decimalSeparator,
        d.locale.decimalSeparator,
      ),
      thousandSeparator:
        typeof locale.thousandSeparator === 'string'
          ? locale.thousandSeparator
          : d.locale.thousandSeparator,
      centPrecision: pickNumber(
        locale.centPrecision,
        d.locale.centPrecision,
        0,
        3,
      ),
      showZeroCents: pickBoolean(locale.showZeroCents, d.locale.showZeroCents),
      language: pickNonEmpty(locale.language, d.locale.language),
      timezone: pickNonEmpty(locale.timezone, d.locale.timezone),
      dateFormat: pickString(
        locale.dateFormat,
        DATE_FORMATS,
        d.locale.dateFormat,
      ),
      use24HourClock: pickBoolean(
        locale.use24HourClock,
        d.locale.use24HourClock,
      ),
      calendar: pickString(locale.calendar, CALENDARS, d.locale.calendar),
    },
    appearance: {
      themePreset: pickString(
        appearance.themePreset,
        THEME_PRESETS,
        d.appearance.themePreset,
      ),
      themeFont: pickString(
        appearance.themeFont,
        THEME_FONTS,
        d.appearance.themeFont,
      ),
      customColors: primary
        ? {
            primary,
            secondary:
              typeof customColors.secondary === 'string'
                ? customColors.secondary
                : undefined,
            accent:
              typeof customColors.accent === 'string'
                ? customColors.accent
                : undefined,
          }
        : null,
    },
    clinical: {
      waitBreachMinutes: pickNumber(
        clinical.waitBreachMinutes,
        d.clinical.waitBreachMinutes,
        0,
        720,
      ),
      triageScale: pickString(
        clinical.triageScale,
        TRIAGE_SCALES,
        d.clinical.triageScale,
      ),
      showPatientNames: pickBoolean(
        clinical.showPatientNames,
        d.clinical.showPatientNames,
      ),
      sessionLockMinutes: pickNumber(
        clinical.sessionLockMinutes,
        d.clinical.sessionLockMinutes,
        0,
        60,
      ),
    },
    scheduling: {
      workingHours: {
        start: pickNonEmpty(
          workingHours.start,
          d.scheduling.workingHours.start,
        ),
        end: pickNonEmpty(workingHours.end, d.scheduling.workingHours.end),
      },
      appointmentDuration: pickNumber(
        scheduling.appointmentDuration,
        d.scheduling.appointmentDuration,
        5,
        240,
      ),
    },
  };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(json));
  } catch {
    // A malformed blob is a site that cannot sign in if this throws. Defaults
    // are a working hospital; an exception is a broken one.
    return {};
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * A partial update: any subset of any group, with the two nested objects
 * partial as well.
 *
 * `Omit` before the intersection is load-bearing — intersecting
 * `Partial<SchedulingSettings>` with a looser `workingHours` resolves to the
 * *stricter* of the two, which would force a caller changing the closing time
 * to resend the opening one.
 */
export type OrganizationSettingsPatch = {
  locale?: Partial<LocaleSettings>;
  appearance?: Partial<Omit<AppearanceSettings, 'customColors'>> & {
    customColors?: Partial<CustomColors> | null;
  };
  clinical?: Partial<ClinicalSettings>;
  scheduling?: Partial<Omit<SchedulingSettings, 'workingHours'>> & {
    workingHours?: Partial<WorkingHours>;
  };
} & Record<string, unknown>;

const GROUPS = ['locale', 'appearance', 'clinical', 'scheduling'] as const;

const LEGACY_FLAT_KEYS = [
  'currency',
  'language',
  'timezone',
  'calendar',
  'defaultCurrency',
  'defaultLanguage',
  'defaultTimezone',
  'defaultCalendar',
  'workingHours',
  'appointmentDuration',
] as const;

/**
 * Merges a patch into the stored blob, leaf by leaf.
 *
 * Keys outside the four known groups are preserved untouched. Some other
 * deployment may be storing something here that this version has never heard
 * of, and silently deleting it because we do not recognise it is the kind of
 * data loss nobody notices for a month.
 */
export function mergeOrganizationSettings(
  stored: unknown,
  patch: OrganizationSettingsPatch | undefined,
): Record<string, unknown> {
  const base = liftLegacyKeys(
    typeof stored === 'string' ? safeParse(stored) : asRecord(stored),
  );

  if (!patch) {
    return stripLegacy(base);
  }

  const incoming = liftLegacyKeys(asRecord(patch));
  const merged: Record<string, unknown> = { ...base };

  // Unknown top-level keys from the patch ride along; known groups merge.
  for (const [key, value] of Object.entries(incoming)) {
    if ((GROUPS as readonly string[]).includes(key)) continue;
    if ((LEGACY_FLAT_KEYS as readonly string[]).includes(key)) continue;
    merged[key] = value;
  }

  for (const group of GROUPS) {
    const current = asRecord(base[group]);
    const next = asRecord(incoming[group]);
    if (Object.keys(next).length === 0) {
      merged[group] = current;
      continue;
    }

    const combined: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) continue;
      // One level deeper for the two nested objects.
      if (key === 'workingHours' || key === 'customColors') {
        if (value === null) {
          combined[key] = null;
          continue;
        }
        combined[key] = { ...asRecord(current[key]), ...asRecord(value) };
        continue;
      }
      combined[key] = value;
    }
    merged[group] = combined;
  }

  return stripLegacy(merged);
}

/** Drops the flat aliases once their values are safely inside a group. */
function stripLegacy(value: Record<string, unknown>): Record<string, unknown> {
  const out = { ...value };
  for (const key of LEGACY_FLAT_KEYS) {
    delete out[key];
  }
  return out;
}

// ── The flat map the mobile app reads ────────────────────────────────────────

export interface SiteBranding {
  name: string;
  logoUrl: string | null;
  logoTextUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

/**
 * The resolved settings as the flat `{key: value}` list `GET /api/settings`
 * serves.
 *
 * Flat and snake_case because that is what the app's `SiteSettings` model
 * already parses — the app shipped against this shape before the endpoint
 * existed, and meeting it here costs one function instead of a release.
 */
export function toSiteSettingsMap(
  branding: SiteBranding,
  settings: OrganizationSettings,
): Record<string, string> {
  const { locale, appearance, clinical, scheduling } = settings;

  const customColors = appearance.customColors
    ? [
        appearance.customColors.primary,
        appearance.customColors.secondary,
        appearance.customColors.accent,
      ]
        .filter((c): c is string => !!c)
        .join(',')
    : '';

  return {
    site_name: branding.name,
    site_logo: branding.logoUrl ?? '',
    logo_text_url: branding.logoTextUrl ?? '',
    primary_color: branding.primaryColor,
    secondary_color: branding.secondaryColor,

    theme_preset: appearance.themePreset,
    theme_custom_colors: customColors,
    theme_font: appearance.themeFont,

    triage_scale: clinical.triageScale,
    wait_breach_minutes: String(clinical.waitBreachMinutes),
    show_patient_names: String(clinical.showPatientNames),
    session_lock_minutes: String(clinical.sessionLockMinutes),

    default_currency_code: locale.currency,
    currency_symbol: locale.currencySymbol,
    currency_position: locale.currencyPosition,
    decimal_sep: locale.decimalSeparator,
    thousand_sep: locale.thousandSeparator,
    cent_precision: String(locale.centPrecision),
    zero_format: String(locale.showZeroCents),
    date_format: locale.dateFormat,
    use_24_hour_clock: String(locale.use24HourClock),
    timezone: locale.timezone,
    language: locale.language,
    calendar: locale.calendar,

    working_hours_start: scheduling.workingHours.start,
    working_hours_end: scheduling.workingHours.end,
    appointment_duration: String(scheduling.appointmentDuration),
  };
}

import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import {
  CALENDARS,
  DATE_FORMATS,
  THEME_FONTS,
  THEME_PRESETS,
  TRIAGE_SCALES,
} from '../organization-settings';

/**
 * The validated shape of `Organization.settings`.
 *
 * Before this, the field was `@IsObject()` — any key, any value, straight into
 * the column. A typo in a theme font reached a phone that has no such face and
 * fell back silently, which reads to the person who saved it as "the setting
 * did not work".
 *
 * Every group is optional, and so is every field inside it: a phone saving one
 * switch must not have to send the other fifteen. The merge in
 * `organization-settings.ts` is what makes that safe.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export class WorkingHoursDto {
  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(CLOCK_TIME, {
    message: 'start must be a 24-hour time such as 08:00',
  })
  start?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(CLOCK_TIME, { message: 'end must be a 24-hour time such as 17:00' })
  end?: string;
}

export class CustomColorsDto {
  @ApiPropertyOptional({ example: '#0E7C7B' })
  @IsOptional()
  @Matches(HEX_COLOR, {
    message: 'primary must be a hex colour such as #0E7C7B',
  })
  primary?: string;

  @ApiPropertyOptional({ example: '#0A5F5E' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'secondary must be a hex colour' })
  secondary?: string;

  @ApiPropertyOptional({ example: '#0070C0' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'accent must be a hex colour' })
  accent?: string;
}

export class LocaleSettingsDto {
  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  @ApiPropertyOptional({ example: '₹' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  currencySymbol?: string;

  @ApiPropertyOptional({ enum: ['before', 'after'] })
  @IsOptional()
  @IsIn(['before', 'after'])
  currencyPosition?: 'before' | 'after';

  @ApiPropertyOptional({ example: '.' })
  @IsOptional()
  @IsIn(['.', ','])
  decimalSeparator?: string;

  @ApiPropertyOptional({ example: ',' })
  @IsOptional()
  @IsIn([',', '.', ' ', ''])
  thousandSeparator?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  centPrecision?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  showZeroCents?: boolean;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  language?: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ enum: DATE_FORMATS })
  @IsOptional()
  @IsIn(DATE_FORMATS)
  dateFormat?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  use24HourClock?: boolean;

  @ApiPropertyOptional({ enum: CALENDARS })
  @IsOptional()
  @IsIn(CALENDARS)
  calendar?: string;
}

export class AppearanceSettingsDto {
  @ApiPropertyOptional({ enum: THEME_PRESETS })
  @IsOptional()
  @IsIn(THEME_PRESETS)
  themePreset?: string;

  @ApiPropertyOptional({ enum: THEME_FONTS })
  @IsOptional()
  @IsIn(THEME_FONTS)
  themeFont?: string;

  @ApiPropertyOptional({ type: CustomColorsDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomColorsDto)
  customColors?: CustomColorsDto | null;
}

export class ClinicalSettingsDto {
  @ApiPropertyOptional({
    example: 30,
    description: '0 turns the breach flag off',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  waitBreachMinutes?: number;

  @ApiPropertyOptional({ enum: TRIAGE_SCALES })
  @IsOptional()
  @IsIn(TRIAGE_SCALES)
  triageScale?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  showPatientNames?: boolean;

  @ApiPropertyOptional({ example: 5, description: '0 never locks the device' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  sessionLockMinutes?: number;
}

export class SchedulingSettingsDto {
  @ApiPropertyOptional({ type: WorkingHoursDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  workingHours?: WorkingHoursDto;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  appointmentDuration?: number;
}

/**
 * A settings patch.
 *
 * The flat fields at the bottom are the console's current vocabulary. They are
 * deprecated, not removed: `forbidNonWhitelisted` is on globally, so dropping
 * them would turn every existing console save into a 400 the moment this
 * deploys. `mergeOrganizationSettings` lifts them into their groups and then
 * discards them, so the stored blob converges on the new shape by itself.
 */
export class OrganizationSettingsDto {
  @ApiPropertyOptional({ type: LocaleSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocaleSettingsDto)
  locale?: LocaleSettingsDto;

  @ApiPropertyOptional({ type: AppearanceSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppearanceSettingsDto)
  appearance?: AppearanceSettingsDto;

  @ApiPropertyOptional({ type: ClinicalSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClinicalSettingsDto)
  clinical?: ClinicalSettingsDto;

  @ApiPropertyOptional({ type: SchedulingSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SchedulingSettingsDto)
  scheduling?: SchedulingSettingsDto;

  // ── Deprecated flat aliases (web console) ─────────────────────────────────

  /** @deprecated use `locale.currency` */
  @IsOptional()
  @IsString()
  currency?: string;

  /** @deprecated use `locale.language` */
  @IsOptional()
  @IsString()
  language?: string;

  /** @deprecated use `locale.timezone` */
  @IsOptional()
  @IsString()
  timezone?: string;

  /** @deprecated use `locale.calendar` */
  @IsOptional()
  @IsString()
  calendar?: string;

  /** @deprecated use `locale.currency` */
  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  /** @deprecated use `locale.language` */
  @IsOptional()
  @IsString()
  defaultLanguage?: string;

  /** @deprecated use `locale.timezone` */
  @IsOptional()
  @IsString()
  defaultTimezone?: string;

  /** @deprecated use `locale.calendar` */
  @IsOptional()
  @IsString()
  defaultCalendar?: string;

  /** @deprecated use `scheduling.workingHours` */
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  workingHours?: WorkingHoursDto;

  /** @deprecated use `scheduling.appointmentDuration` */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  appointmentDuration?: number;
}

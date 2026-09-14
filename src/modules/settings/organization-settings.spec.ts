import {
  DEFAULT_ORGANIZATION_SETTINGS,
  mergeOrganizationSettings,
  resolveOrganizationSettings,
  toSiteSettingsMap,
} from './organization-settings';

describe('organization settings', () => {
  describe('resolveOrganizationSettings', () => {
    it('returns the documented defaults for a site that has never been configured', () => {
      expect(resolveOrganizationSettings(null)).toEqual(
        DEFAULT_ORGANIZATION_SETTINGS,
      );
      expect(resolveOrganizationSettings('{}')).toEqual(
        DEFAULT_ORGANIZATION_SETTINGS,
      );
    });

    it('survives a malformed blob rather than throwing', () => {
      // A site whose settings column is corrupt must still be able to sign in.
      expect(resolveOrganizationSettings('{not json')).toEqual(
        DEFAULT_ORGANIZATION_SETTINGS,
      );
    });

    it('lifts the console flat keys into their groups', () => {
      const resolved = resolveOrganizationSettings({
        currency: 'ETB',
        language: 'am',
        timezone: 'Africa/Addis_Ababa',
        workingHours: { start: '09:00', end: '18:00' },
        appointmentDuration: 45,
      });

      expect(resolved.locale.currency).toBe('ETB');
      expect(resolved.locale.currencySymbol).toBe('Br');
      expect(resolved.locale.language).toBe('am');
      expect(resolved.locale.timezone).toBe('Africa/Addis_Ababa');
      expect(resolved.scheduling.workingHours).toEqual({
        start: '09:00',
        end: '18:00',
      });
      expect(resolved.scheduling.appointmentDuration).toBe(45);
    });

    it('also accepts the default* spellings the console reads', () => {
      const resolved = resolveOrganizationSettings({
        defaultCurrency: 'USD',
        defaultCalendar: 'gregorian',
      });

      expect(resolved.locale.currency).toBe('USD');
      expect(resolved.locale.currencySymbol).toBe('$');
      expect(resolved.locale.calendar).toBe('gregorian');
    });

    it('rejects a value outside its vocabulary instead of passing it through', () => {
      // Rows predating the typed DTO were written by an @IsObject() field, so
      // the read path validates too — a font nobody bundled must not reach a
      // device.
      const resolved = resolveOrganizationSettings({
        appearance: { themeFont: 'comic-sans', themePreset: 'neon' },
        clinical: { triageScale: 'made-up' },
        locale: { dateFormat: 'nonsense' },
      });

      expect(resolved.appearance.themeFont).toBe('montserrat');
      expect(resolved.appearance.themePreset).toBe('default');
      expect(resolved.clinical.triageScale).toBe('p1-p5');
      expect(resolved.locale.dateFormat).toBe('dd/MM/yyyy');
    });

    it('clamps numbers to their documented range', () => {
      const resolved = resolveOrganizationSettings({
        clinical: { waitBreachMinutes: 5000, sessionLockMinutes: -3 },
        scheduling: { appointmentDuration: 1 },
      });

      expect(resolved.clinical.waitBreachMinutes).toBe(720);
      expect(resolved.clinical.sessionLockMinutes).toBe(0);
      expect(resolved.scheduling.appointmentDuration).toBe(5);
    });

    it('keeps zero for wait breach, because zero means "off"', () => {
      const resolved = resolveOrganizationSettings({
        clinical: { waitBreachMinutes: 0 },
      });
      expect(resolved.clinical.waitBreachMinutes).toBe(0);
    });
  });

  describe('mergeOrganizationSettings', () => {
    it('preserves keys the patch did not mention', () => {
      // The whole point: a phone saving a theme must not wipe the working hours
      // somebody set on the web an hour ago.
      const stored = {
        locale: { currency: 'ETB', timezone: 'Africa/Addis_Ababa' },
        scheduling: { workingHours: { start: '07:00', end: '19:00' } },
      };

      const merged = mergeOrganizationSettings(stored, {
        appearance: { themePreset: 'forest' },
      });

      const resolved = resolveOrganizationSettings(merged);
      expect(resolved.appearance.themePreset).toBe('forest');
      expect(resolved.locale.currency).toBe('ETB');
      expect(resolved.scheduling.workingHours).toEqual({
        start: '07:00',
        end: '19:00',
      });
    });

    it('merges one leaf of a group without dropping its siblings', () => {
      const merged = mergeOrganizationSettings(
        { clinical: { waitBreachMinutes: 45, showPatientNames: false } },
        { clinical: { waitBreachMinutes: 20 } },
      );

      const resolved = resolveOrganizationSettings(merged);
      expect(resolved.clinical.waitBreachMinutes).toBe(20);
      expect(resolved.clinical.showPatientNames).toBe(false);
    });

    it('merges the nested working-hours object rather than replacing it', () => {
      const merged = mergeOrganizationSettings(
        { scheduling: { workingHours: { start: '08:00', end: '17:00' } } },
        { scheduling: { workingHours: { end: '20:00' } } },
      );

      const resolved = resolveOrganizationSettings(merged);
      expect(resolved.scheduling.workingHours).toEqual({
        start: '08:00',
        end: '20:00',
      });
    });

    it('keeps unknown top-level keys another deployment may be storing', () => {
      const merged = mergeOrganizationSettings(
        { someOtherIntegration: { token: 'abc' } },
        { clinical: { triageScale: 'esi' } },
      );

      expect(merged.someOtherIntegration).toEqual({ token: 'abc' });
    });

    it('lifts a legacy flat patch into its group and stops storing the alias', () => {
      const merged = mergeOrganizationSettings(
        {},
        { currency: 'KES', appointmentDuration: 15 },
      );

      expect(merged.currency).toBeUndefined();
      expect(merged.appointmentDuration).toBeUndefined();
      const resolved = resolveOrganizationSettings(merged);
      expect(resolved.locale.currency).toBe('KES');
      expect(resolved.scheduling.appointmentDuration).toBe(15);
    });

    it('an empty patch is a no-op', () => {
      const stored = { clinical: { waitBreachMinutes: 12 } };
      const merged = mergeOrganizationSettings(stored, undefined);
      expect(
        resolveOrganizationSettings(merged).clinical.waitBreachMinutes,
      ).toBe(12);
    });
  });

  describe('toSiteSettingsMap', () => {
    const branding = {
      name: "St Aidan's General",
      logoUrl: null,
      logoTextUrl: null,
      primaryColor: '#0E7C7B',
      secondaryColor: '#0070C0',
    };

    it('emits every key the mobile SiteSettings model reads', () => {
      const map = toSiteSettingsMap(branding, DEFAULT_ORGANIZATION_SETTINGS);

      // These strings are the app's contract (lib/app/data/models/site_settings.dart).
      for (const key of [
        'site_name',
        'site_logo',
        'theme_preset',
        'theme_custom_colors',
        'theme_font',
        'triage_scale',
        'wait_breach_minutes',
        'show_patient_names',
        'session_lock_minutes',
        'default_currency_code',
        'currency_symbol',
        'currency_position',
        'decimal_sep',
        'thousand_sep',
        'cent_precision',
        'zero_format',
        'date_format',
        'use_24_hour_clock',
      ]) {
        expect(map[key]).toBeDefined();
      }
      expect(map.site_name).toBe("St Aidan's General");
      expect(map.wait_breach_minutes).toBe('30');
      expect(map.use_24_hour_clock).toBe('true');
    });

    it('serialises custom colours as the comma list the app parses', () => {
      const map = toSiteSettingsMap(branding, {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        appearance: {
          themePreset: 'custom',
          themeFont: 'inter',
          customColors: { primary: '#112233', secondary: '#445566' },
        },
      });

      expect(map.theme_custom_colors).toBe('#112233,#445566');
      expect(map.theme_preset).toBe('custom');
    });

    it('emits an empty string, never "null", when there is no logo', () => {
      // The app treats these as display strings; the four characters "null"
      // would render as a logo URL.
      const map = toSiteSettingsMap(branding, DEFAULT_ORGANIZATION_SETTINGS);
      expect(map.site_logo).toBe('');
      expect(map.logo_text_url).toBe('');
    });
  });
});

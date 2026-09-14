import { resolveOrganizationId, isCrossTenantAdmin } from './tenant.util';
import { SystemRole } from '../enums/role.enum';
import { AuthenticatedUser } from '../types/jwt-payload.type';

const user = (organizationId: string, roles: string[] = ['DOCTOR']) =>
  ({
    id: 'u-1',
    email: 'a@b.c',
    organizationId,
    roles,
    permissions: [],
  }) as unknown as AuthenticatedUser;

describe('resolveOrganizationId', () => {
  it('returns the token organisation when nothing is requested', () => {
    expect(resolveOrganizationId(user('org-a'))).toBe('org-a');
  });

  it('allows a request for the caller own organisation', () => {
    expect(resolveOrganizationId(user('org-a'), 'org-a')).toBe('org-a');
  });

  it('refuses a request for another organisation', () => {
    // This is the cross-tenant read that `?organizationId=` used to allow.
    expect(() => resolveOrganizationId(user('org-a'), 'org-b')).toThrow(
      /another organisation/,
    );
  });

  it('lets a super admin reach another organisation deliberately', () => {
    expect(
      resolveOrganizationId(user('org-a', [SystemRole.SUPER_ADMIN]), 'org-b'),
    ).toBe('org-b');
  });

  it('refuses rather than substituting a placeholder when the token has none', () => {
    // The previous code fell back to the literal 'org-demo', an organisation
    // the seed never creates, so writes landed nowhere and reads came back
    // empty with a 200.
    expect(() => resolveOrganizationId(undefined)).toThrow(
      /not attached to an organisation/,
    );
  });
});

describe('isCrossTenantAdmin', () => {
  it('is true only for a super admin', () => {
    expect(isCrossTenantAdmin(user('org-a', [SystemRole.SUPER_ADMIN]))).toBe(
      true,
    );
    expect(isCrossTenantAdmin(user('org-a', ['ADMIN']))).toBe(false);
    expect(isCrossTenantAdmin(undefined)).toBe(false);
  });
});

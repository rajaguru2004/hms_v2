import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppointmentsController } from './appointments.controller';

/**
 * What this controller actually maps — read off the metadata Nest reads.
 *
 * Every other test in this module exercises the service, and a service test
 * cannot see a routing bug: the handler is perfectly correct and simply never
 * runs. Two ways of getting that wrong have already shipped here, and both
 * failed as a bare `404` from the router before a guard, a pipe or a service
 * was involved.
 */
describe('AppointmentsController routes', () => {
  /** `['PATCH :id', 'GET doctors', …]`, in declaration order. */
  const mapped = (): string[] => {
    const prototype = AppointmentsController.prototype as unknown as Record<
      string,
      unknown
    >;

    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = prototype[name] as (...args: unknown[]) => unknown;
        const method = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        ) as RequestMethod;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        return `${RequestMethod[method]} ${path}`;
      });
  };

  it('answers both PUT and PATCH on one appointment', () => {
    // Stacking `@Put(':id')` and `@Patch(':id')` on a single handler does not
    // register two routes — both write `METHOD_METADATA` on the same
    // descriptor and the outer decorator wins. That is what shipped: only PUT
    // was mapped, and the mobile app, which sends PATCH for this collection,
    // could not confirm, check in, complete, cancel or reschedule anything.
    expect(mapped()).toEqual(expect.arrayContaining(['PUT :id', 'PATCH :id']));
  });

  it('declares the literal GET routes before the parameterised one', () => {
    // Nest matches in declaration order, so `@Get(':id')` above `@Get('doctors')`
    // swallows it and the booking screen's doctor list arrives as a lookup for
    // an appointment whose id is the word "doctors".
    const routes = mapped();
    const byId = routes.indexOf('GET :id');

    for (const literal of ['GET doctors', 'GET availability']) {
      const at = routes.indexOf(literal);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(byId);
    }
  });
});

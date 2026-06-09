import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule — global module so PrismaService is available everywhere.
 *
 * @Global() means you don't need to import PrismaModule in every feature module.
 * Only import it once in AppModule.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

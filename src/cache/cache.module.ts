import { Global, Module } from '@nestjs/common';
import { AppCacheService } from './cache.service';
import { AuthCacheService } from './auth-cache.service';

@Global()
@Module({
  providers: [AppCacheService, AuthCacheService],
  exports: [AppCacheService, AuthCacheService],
})
export class AppCacheModule {}

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Usage: @Public() on any route to bypass JWT authentication
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
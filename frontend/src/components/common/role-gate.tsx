'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import type { Role } from '@/types';

interface RoleGateProps {
  allowed: Role[];
  fallback?: ReactNode;
  children: ReactNode;
}

export default function RoleGate({ allowed, fallback = null, children }: RoleGateProps) {
  const { role } = useAuth();
  if (!role || !allowed.includes(role)) return <>{fallback}</>;
  return <>{children}</>;
}

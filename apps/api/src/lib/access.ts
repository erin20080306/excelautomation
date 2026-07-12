export function hasUnlimitedAccess(role: string): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

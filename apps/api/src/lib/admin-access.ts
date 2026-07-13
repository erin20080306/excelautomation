export function isAllowedSuperadmin(email: string, allowedEmails: string): boolean {
  const normalized = email.trim().toLowerCase();
  return allowedEmails.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean).includes(normalized);
}

export function effectivePlatformRole(role: string, email: string, allowedEmails: string): 'USER' | 'SUPERADMIN' {
  return role === 'SUPERADMIN' && isAllowedSuperadmin(email, allowedEmails) ? 'SUPERADMIN' : 'USER';
}

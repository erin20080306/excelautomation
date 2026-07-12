export type WorkspacePermission = 'content:read' | 'content:write' | 'workspace:manage';

const permissions: Record<string, WorkspacePermission[]> = {
  OWNER: ['content:read', 'content:write', 'workspace:manage'],
  ADMIN: ['content:read', 'content:write', 'workspace:manage'],
  EDITOR: ['content:read', 'content:write'],
  VIEWER: ['content:read']
};

export function hasPermission(role: string, permission: WorkspacePermission): boolean {
  return permissions[role]?.includes(permission) ?? false;
}

export function hasUnlimitedUsage(platformRole: string): boolean {
  return platformRole === 'SUPERADMIN';
}

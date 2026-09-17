import {
    ForbiddenException,
    Injectable,
} from '@nestjs/common';

import { Role } from '../../../generated/prisma/client';

@Injectable()
export class FinancePermissionService {

    // ============================================================
    // FINANCES
    // ============================================================

    canViewFinance(role: Role): boolean {
        return (
            role === Role.AVOCAT ||
            role === Role.COMPTABLE
        );
    }

    // ============================================================
    // CAISSES
    // ============================================================

    canViewCaisses(role: Role): boolean {
        return (
            role === Role.AVOCAT ||
            role === Role.COMPTABLE
        );
    }

    canCreateCaisse(role: Role): boolean {
        return role === Role.COMPTABLE;
    }

    canUpdateCaisse(role: Role): boolean {
        return role === Role.COMPTABLE;
    }

    canDeleteCaisse(role: Role): boolean {
        return role === Role.COMPTABLE;
    }

    // ============================================================
    // MOUVEMENTS
    // ============================================================

    canViewMouvements(role: Role): boolean {
        return (
            role === Role.AVOCAT ||
            role === Role.COMPTABLE
        );
    }

    canCreateMouvement(role: Role): boolean {
        return role === Role.COMPTABLE;
    }

    // ============================================================
    // PIECES JOINTES
    // ============================================================

    canViewPieceJointes(role: Role): boolean {
        return (
            role === Role.AVOCAT ||
            role === Role.COMPTABLE
        );
    }

    canManagePieceJointes(role: Role): boolean {
        return role === Role.COMPTABLE;
    }

    // ============================================================
    // AUDIT
    // ============================================================

    canViewAudit(role: Role): boolean {
        return role === Role.COMPTABLE;
    }

    // ============================================================
    // PERMISSIONS FRONTEND
    // ============================================================

    getFinancePermissions(role: Role) {
        return {
            canViewFinance:
                this.canViewFinance(role),

            canViewCaisses:
                this.canViewCaisses(role),

            canCreateCaisse:
                this.canCreateCaisse(role),

            canUpdateCaisse:
                this.canUpdateCaisse(role),

            canDeleteCaisse:
                this.canDeleteCaisse(role),

            canViewMouvements:
                this.canViewMouvements(role),

            canCreateMouvement:
                this.canCreateMouvement(role),

            canViewPieceJointes:
                this.canViewPieceJointes(role),

            canManagePieceJointes:
                this.canManagePieceJointes(role),

            canViewAudit:
                this.canViewAudit(role),
        };
    }

    // ============================================================
    // HELPER
    // ============================================================

    require(
        allowed: boolean,
        message =
            'Vous n’avez pas les permissions nécessaires.',
    ): void {
        if (!allowed) {
            throw new ForbiddenException(
                message,
            );
        }
    }
}
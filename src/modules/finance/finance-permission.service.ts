import {
    ForbiddenException,
    Injectable,
} from '@nestjs/common';

import {
    Role,
} from '../../../generated/prisma/client';

@Injectable()
export class FinancePermissionService {

    // ============================================================
    // HELPER INTERNE
    // ============================================================

    private isFinanceManager(
        role: Role,
    ): boolean {
        return (
            role === Role.AVOCAT ||
            role === Role.COMPTABLE
        );
    }

    // ============================================================
    // FINANCES
    // ============================================================

    canViewFinance(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    // ============================================================
    // COMPTES
    //
    // Les noms internes "Caisse" sont conservés temporairement
    // afin de ne pas casser les routes et le frontend.
    // ============================================================

    canViewCaisses(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    canCreateCaisse(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    canUpdateCaisse(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    canDeleteCaisse(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    // ============================================================
    // MOUVEMENTS
    // ============================================================

    canViewMouvements(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    canCreateMouvement(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    // ============================================================
    // PIECES JOINTES
    // ============================================================

    canViewPieceJointes(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    canManagePieceJointes(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    // ============================================================
    // AUDIT
    // ============================================================

    canViewAudit(
        role: Role,
    ): boolean {
        return this.isFinanceManager(
            role,
        );
    }

    // ============================================================
    // PERMISSIONS FRONTEND
    // ============================================================

    getFinancePermissions(
        role: Role,
    ) {
        return {
            canViewFinance:
                this.canViewFinance(
                    role,
                ),

            canViewCaisses:
                this.canViewCaisses(
                    role,
                ),

            canCreateCaisse:
                this.canCreateCaisse(
                    role,
                ),

            canUpdateCaisse:
                this.canUpdateCaisse(
                    role,
                ),

            canDeleteCaisse:
                this.canDeleteCaisse(
                    role,
                ),

            canViewMouvements:
                this.canViewMouvements(
                    role,
                ),

            canCreateMouvement:
                this.canCreateMouvement(
                    role,
                ),

            canViewPieceJointes:
                this.canViewPieceJointes(
                    role,
                ),

            canManagePieceJointes:
                this.canManagePieceJointes(
                    role,
                ),

            canViewAudit:
                this.canViewAudit(
                    role,
                ),
        };
    }

    // ============================================================
    // REQUIRE
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
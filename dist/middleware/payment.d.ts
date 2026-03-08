import { Request, Response, NextFunction } from 'express';
export declare function requirePayment(required?: boolean): (req: Request, res: Response, next: NextFunction) => void;
export declare function getPaymentRequirement(): {
    price: number;
    currency: string;
    description: string;
    beneficiary: string;
};
export declare function hasPaymentHeader(req: Request): boolean;
//# sourceMappingURL=payment.d.ts.map
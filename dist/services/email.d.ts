interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}
export declare function sendEmail(options: EmailOptions): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function sendVerificationEmail(email: string, token: string): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function sendWelcomeEmail(email: string, name?: string): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function sendPasswordResetEmail(email: string, token: string): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function sendAPIKeyCreatedEmail(email: string, keyName: string): Promise<{
    success: boolean;
    error?: string;
}>;
export {};
//# sourceMappingURL=email.d.ts.map
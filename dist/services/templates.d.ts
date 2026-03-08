export interface Template {
    id: string;
    name: string;
    description: string;
    format: 'json' | 'markdown' | 'csv' | 'html' | 'text';
    template: string;
}
export declare const TEMPLATES: Template[];
export declare function applyTemplate(templateId: string, response: string): {
    success: boolean;
    formatted?: string;
    error?: string;
};
export declare function transformResponse(response: string, options: {
    format?: 'json' | 'markdown' | 'csv' | 'html' | 'text';
    template?: string;
    uppercase?: boolean;
    lowercase?: boolean;
    trim?: boolean;
    escape?: boolean;
}): string;
//# sourceMappingURL=templates.d.ts.map
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
    {
        variants: {
            variant: {
                default: 'bg-primary/15 text-primary',
                secondary: 'bg-secondary text-secondary-foreground',
                success: 'bg-success/15 text-success',
                warning: 'bg-warning/15 text-warning',
                destructive: 'bg-destructive/15 text-destructive',
                outline: 'border border-current bg-transparent',
            },
        },
        defaultVariants: { variant: 'default' },
    }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
    pulse?: boolean;
}

function Badge({ className, variant, pulse, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), pulse && 'status-pulse', className)} {...props} />
    );
}

export { Badge, badgeVariants };

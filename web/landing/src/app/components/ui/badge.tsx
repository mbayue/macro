import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground [a]:hover:border-bar-hover',
        outline: 'border-bar bg-surface text-muted-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground',
        destructive: 'border-bad bg-bad/10 text-bad [a]:hover:bg-bad [a]:hover:text-destructive-foreground',
        ok: 'border-ok bg-ok/10 text-ok',
        warn: 'border-warn bg-warn/10 text-warn',
        live: 'bg-primary text-primary-foreground border-transparent',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-accent-text underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  });
}

export { Badge, badgeVariants };

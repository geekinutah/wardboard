import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cx } from './cx.ts';
import './components.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export type ButtonProps = {
  variant?: ButtonVariant | undefined;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button type={type} className={cx('wb-button', `wb-button-${variant}`, className)} {...rest}>
      {children}
    </button>
  );
}

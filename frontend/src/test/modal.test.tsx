import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../components/ui/Modal';

describe('accessible modal dialog', () => {
  it('traps keyboard focus, closes with Escape, and restores focus and scrolling', async () => {
    const user = userEvent.setup();
    function ModalExample() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open example</button>
          {open && (
            <Modal title="Example" onClose={() => setOpen(false)}>
              <button>Last dialog action</button>
            </Modal>
          )}
        </>
      );
    }
    render(<ModalExample />);
    const opener = screen.getByRole('button', { name: 'Open example' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Example' }).tagName).toBe('DIALOG');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last dialog action' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps inside clicks open and dismisses through the native backdrop button', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Example" onClose={onClose}>
        <p>Dialog content</p>
      </Modal>,
    );
    fireEvent.click(screen.getByText('Dialog content'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog backdrop' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPanel, type SearchPanelProps } from '../components/search/SearchPanel';
import { categories } from './fixtures';

function props(overrides: Partial<SearchPanelProps> = {}): SearchPanelProps {
  return {
    categories,
    selected: [],
    onSelected: vi.fn(),
    advanced: false,
    onAdvanced: vi.fn(),
    mode: 'and',
    onMode: vi.fn(),
    confidence: 0.5,
    minConfidence: 0.15,
    onConfidence: vi.fn(),
    sort: 'confidence_desc',
    onSort: vi.fn(),
    onSearch: vi.fn(),
    onReset: vi.fn(),
    loading: false,
    searching: false,
    ...overrides,
  };
}

describe('object search controls', () => {
  it('lists only indexed categories and requires a selection before searching', async () => {
    const user = userEvent.setup();
    const callbacks = props();
    const { rerender } = render(<SearchPanel {...callbacks} />);
    expect(screen.getByRole('option', { name: 'Person (3 images)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Car (2 images)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /dog/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search Images' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Select an Object'), 'car');
    expect(callbacks.onSelected).toHaveBeenCalledWith(['car']);
    rerender(<SearchPanel {...callbacks} selected={['car']} />);
    await user.click(screen.getByRole('button', { name: 'Search Images' }));
    expect(callbacks.onSearch).toHaveBeenCalledOnce();
  });

  it('supports selecting multiple objects and changing AND to OR', async () => {
    const user = userEvent.setup();
    const callbacks = props({ advanced: true });
    function ControlledSearch() {
      const [selected, setSelected] = useState<string[]>([]);
      return <SearchPanel {...callbacks} selected={selected} onSelected={setSelected} />;
    }
    render(<ControlledSearch />);
    await user.click(screen.getByRole('button', { name: 'Choose object categories' }));
    await user.click(screen.getByRole('checkbox', { name: /Person\s*3 images/ }));
    await user.click(screen.getByRole('checkbox', { name: /Car\s*2 images/ }));
    expect(screen.getByRole('button', { name: '2 object categories selected' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Match all (AND)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Match any (OR)' }));
    expect(callbacks.onMode).toHaveBeenCalledWith('or');
    await user.click(screen.getByRole('button', { name: 'Remove car filter' }));
    expect(screen.queryByRole('button', { name: 'Remove car filter' })).not.toBeInTheDocument();
  });

  it('forwards confidence, sort, and reset changes', async () => {
    const user = userEvent.setup();
    const callbacks = props({ selected: ['car'] });
    render(<SearchPanel {...callbacks} />);
    fireEvent.change(screen.getByRole('slider', { name: /minimum confidence/i }), {
      target: { value: '0.8' },
    });
    expect(callbacks.onConfidence).toHaveBeenCalledWith(0.8);
    await user.selectOptions(screen.getByLabelText('Sort Results'), 'oldest');
    expect(callbacks.onSort).toHaveBeenCalledWith('oldest');
    await user.click(screen.getByRole('button', { name: 'Reset Filters' }));
    expect(callbacks.onReset).toHaveBeenCalledOnce();
  });

  it('disables unavailable categories while loading and explains an empty index', () => {
    const callbacks = props({ categories: [], loading: true });
    const { rerender } = render(<SearchPanel {...callbacks} />);
    expect(screen.getByLabelText('Select an Object')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Loading categories…' })).toBeInTheDocument();
    rerender(<SearchPanel {...callbacks} loading={false} />);
    expect(screen.getByRole('option', { name: 'No objects detected yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search Images' })).toBeDisabled();
  });

  it('reduces a multi-object selection when advanced mode is disabled', async () => {
    const user = userEvent.setup();
    const callbacks = props({ advanced: true, selected: ['person', 'car'] });
    render(<SearchPanel {...callbacks} />);
    await user.click(screen.getByRole('checkbox', { name: 'Advanced Search' }));
    expect(callbacks.onAdvanced).toHaveBeenCalledWith(false);
    expect(callbacks.onSelected).toHaveBeenCalledWith(['person']);
  });
});

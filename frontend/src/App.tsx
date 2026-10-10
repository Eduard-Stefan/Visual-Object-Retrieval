import { useCollection } from './hooks/useCollection';
import { errorMessage } from './lib/format';
import { Sidebar } from './components/layout/Sidebar';
import { SearchPanel } from './components/search/SearchPanel';
import { StatisticCards } from './components/statistics/Statistics';
import { ErrorNotice } from './components/ui/Feedback';
import { CollectionDialogs } from './components/workspace/CollectionDialogs';
import { CollectionResults } from './components/workspace/CollectionResults';
import {
  CollectionFeedback,
  CollectionInsights,
  CollectionToolbar,
  PageHeading,
  WorkspaceFooter,
  WorkspaceHeader,
} from './components/workspace/WorkspaceOverview';

export default function App() {
  const model = useCollection();
  const {
    view,
    system,
    categories,
    statistics,
    images,
    confidence,
    selected,
    advanced,
    mode,
    sort,
    currentSearch,
    minConfidence,
    processing,
    upload,
    setConfidence,
    setSelected,
    setAdvanced,
    setMode,
    setSort,
    setPage,
    setActiveSearch,
    resetFilters,
    changeView,
    openUpload,
  } = model;
  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onView={changeView}
        onUpload={openUpload}
        processing={processing || upload.isPending}
        system={system.data}
        total={statistics.data?.total_images}
      />
      <div className="main-shell">
        <WorkspaceHeader model={model} />
        <main className="main-content">
          <PageHeading view={view} onUpload={openUpload} busy={processing || upload.isPending} />
          <CollectionFeedback model={model} />
          <StatisticCards
            data={statistics.data}
            results={view === 'statistics' ? undefined : images.data?.total}
            loading={statistics.isLoading}
          />
          {statistics.isError && !system.isError && (
            <ErrorNotice
              message={errorMessage(statistics.error)}
              onRetry={() => void statistics.refetch()}
            />
          )}
          {view === 'search' && (
            <SearchPanel
              categories={categories.data ?? []}
              selected={selected}
              onSelected={setSelected}
              advanced={advanced}
              onAdvanced={setAdvanced}
              mode={mode}
              onMode={setMode}
              confidence={confidence}
              minConfidence={minConfidence}
              onConfidence={(value) => {
                setConfidence(value);
                setPage(1);
              }}
              sort={sort}
              onSort={(value) => {
                setSort(value);
                setPage(1);
              }}
              onSearch={() => {
                setActiveSearch({ categories: [...selected], mode });
                setPage(1);
              }}
              onReset={resetFilters}
              loading={categories.isLoading}
              searching={images.isFetching && !!currentSearch}
            />
          )}
          {categories.isError && view === 'search' && !system.isError && (
            <ErrorNotice
              message={errorMessage(categories.error)}
              onRetry={() => void categories.refetch()}
            />
          )}
          {view === 'collection' && <CollectionToolbar model={model} />}
          {view !== 'statistics' && <CollectionResults model={model} />}
          <CollectionInsights model={model} />
          <WorkspaceFooter system={system.data} />
        </main>
      </div>
      <CollectionDialogs model={model} />
    </div>
  );
}

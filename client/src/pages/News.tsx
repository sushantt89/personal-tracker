import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, ButtonBase, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment, Skeleton, Stack, Tab, Tabs, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import dayjs from 'dayjs';
import { get, post } from '../api/client';
import { PageHeader, LoadingBlock, ErrorBlock, EmptyState } from '../components/common';

interface NewsItem { id: string; title: string; source: string; link: string; publishedAt: string | null }
interface NewsResult { key: string; label: string; items: NewsItem[]; fetchedAt: string | null; stale: boolean; error?: string }
interface Category { key: string; label: string }

/** "5 min ago", "3 h ago", "yesterday", "2 Oct" */
const ago = (iso: string | null) => {
  if (!iso) return '';
  const mins = dayjs().diff(dayjs(iso), 'minute');
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  if (mins < 48 * 60) return 'yesterday';
  return dayjs(iso).format('D MMM');
};

interface Summary { url: string; bullets: string[]; limited: boolean; error?: string }

/** The main points of one story, with a button for the full article on the publisher's site. */
function SummaryDialog({ item, onClose }: { item: NewsItem | null; onClose: () => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const q = useQuery({
    queryKey: ['news', 'summary', item?.link], enabled: !!item, staleTime: 60 * 60 * 1000, retry: false,
    queryFn: () => post<Summary>('/news/summary', { link: item!.link, title: item!.title }),
  });
  const s = q.data;
  const href = s?.url || item?.link;
  return (
    <Dialog open={!!item} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} scroll="paper" aria-labelledby="news-summary-title">
      <DialogTitle id="news-summary-title" sx={{ pr: 6, lineHeight: 1.3 }}>
        {item?.title}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{[item?.source, ago(item?.publishedAt ?? null)].filter(Boolean).join(' · ')}</Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers aria-live="polite">
        {q.isLoading ? (
          <Stack spacing={1.5} aria-label="Reading the article">
            <Typography variant="body2" color="text.secondary">Reading the article…</Typography>
            {[92, 80, 96, 70].map((w, i) => <Skeleton key={i} variant="text" width={`${w}%`} height={26} />)}
          </Stack>
        ) : q.error || s?.error || !s?.bullets.length ? (
          <Alert severity="info">{s?.error ?? 'Couldn’t get the main points for this one.'} Use the button below to read it on {item?.source || 'the publisher’s site'}.</Alert>
        ) : (
          <>
            <Typography variant="overline" color="text.secondary">{s.limited ? 'In brief' : 'Main points'}</Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, '& li': { mb: 1.25, lineHeight: 1.5 }, '& li::marker': { color: 'primary.main' } }}>
              {s.bullets.map((b, i) => <Typography key={i} component="li" variant="body1">{b}</Typography>)}
            </Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
              {s.limited ? 'Only a short description could be read from this publisher. ' : 'These are key sentences picked from the article itself, not a full account. '}Read the article for the whole story.
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button color="inherit" onClick={onClose}>Close</Button>
        <Button variant="contained" component="a" href={href} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNewIcon />}>Read full article</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function News() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const cats = useQuery({ queryKey: ['news', 'categories'], queryFn: () => get<{ items: Category[] }>('/news/categories'), staleTime: Infinity });
  const search = params.get('q') ?? '';
  const tab = params.get('topic') ?? cats.data?.items[0]?.key ?? '';
  const [text, setText] = useState(search);
  useEffect(() => setText(search), [search]);
  const [refreshing, setRefreshing] = useState(false);
  const [reading, setReading] = useState<NewsItem | null>(null);

  const key = ['news', search ? `q:${search}` : tab];
  const news = useQuery({
    queryKey: key, enabled: !!(search || tab), staleTime: 10 * 60 * 1000,
    queryFn: () => get<NewsResult>('/news', search ? { q: search } : { category: tab }),
  });
  const refresh = async () => {
    setRefreshing(true);
    try { qc.setQueryData(key, await get<NewsResult>('/news', { ...(search ? { q: search } : { category: tab }), refresh: 'true' })); } catch { /* the list shows its own error */ }
    finally { setRefreshing(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); const q = text.trim(); if (q.length >= 2) setParams({ q }); };
  const n = news.data;

  return (
    <Box>
      <PageHeader title="News" subtitle="Headlines from the last week, by topic. Tap one for its main points; open the full article only if you want it."
        actions={<Button startIcon={<RefreshIcon />} onClick={refresh} disabled={refreshing || news.isLoading}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>} />

      <Card sx={{ mb: 2 }}>
        <Tabs value={search ? false : tab || false} onChange={(_, v) => setParams({ topic: v })} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label="News topics">
          {(cats.data?.items ?? []).map((c) => <Tab key={c.key} value={c.key} label={c.label} sx={{ textTransform: 'none', fontWeight: 600 }} />)}
        </Tabs>
        <Divider />
        <Box component="form" onSubmit={submit} sx={{ p: 1.5 }}>
          <TextField placeholder="Search any other topic…" value={text} onChange={(e) => setText(e.target.value)} sx={{ maxWidth: 420 }}
            slotProps={{ htmlInput: { maxLength: 80, 'aria-label': 'Search news' }, input: {
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              endAdornment: text ? <InputAdornment position="end"><IconButton size="small" aria-label="Clear search" onClick={() => { setText(''); if (search) setParams(tab ? { topic: tab } : {}); }}><CloseIcon fontSize="small" /></IconButton></InputAdornment> : undefined,
            } }} />
        </Box>
      </Card>

      {search && <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}><Typography variant="body2" color="text.secondary">Results for</Typography><Chip label={search} onDelete={() => setParams({})} /></Stack>}
      {n?.error && <Alert severity="warning" sx={{ mb: 2 }}>{n.error}{n.items.length ? ` Showing what was loaded ${ago(n.fetchedAt)}.` : ' Try Refresh in a minute.'}</Alert>}

      <Card>
        {news.isLoading || cats.isLoading ? <Box sx={{ p: 2 }}><LoadingBlock rows={8} height={52} /></Box>
          : news.error ? <Box sx={{ p: 2 }}><ErrorBlock error={news.error} onRetry={news.refetch} /></Box>
          : !n?.items.length ? <EmptyState title="No headlines found" message={search ? 'Nothing in the last week for that search. Try different words.' : 'Nothing in the last week for this topic.'} />
          : n.items.map((it, i) => (
            <Box key={it.id + i}>
              {i > 0 && <Divider />}
              <ButtonBase onClick={() => setReading(it)} aria-haspopup="dialog"
                sx={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, minHeight: 56, '&:hover': { bgcolor: 'action.hover' }, '&:hover .news-title': { color: 'primary.main' }, '&.Mui-focusVisible': { bgcolor: 'action.focus' } }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography className="news-title" variant="body1" sx={{ fontWeight: 600, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{it.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{[it.source, ago(it.publishedAt)].filter(Boolean).join(' · ')}</Typography>
                </Box>
                <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled', flexShrink: 0 }} />
              </ButtonBase>
            </Box>
          ))}
      </Card>
      {n?.fetchedAt && !n.error && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>Updated {ago(n.fetchedAt)} · headlines via Google News</Typography>}
      <SummaryDialog item={reading} onClose={() => setReading(null)} />
    </Box>
  );
}

import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Card, List, ListItemButton, ListItemText, Typography, Chip, Stack, Divider } from '@mui/material';
import { get } from '../api/client';
import { PageHeader, LoadingBlock, EmptyState } from '../components/common';
import { money, titleCase } from '../utils/format';

interface Result { type: string; id: string; title: string; subtitle?: string; amount?: number; link: string }

export default function SearchPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const q = params.get('q') ?? '';
  const res = useQuery({ queryKey: ['search', q], queryFn: () => get<{ results: Result[] }>('/search', { q }), enabled: q.length >= 2 });
  const groups = new Map<string, Result[]>();
  for (const r of res.data?.results ?? []) groups.set(r.type, [...(groups.get(r.type) ?? []), r]);
  return (
    <Box>
      <PageHeader title={`Search: “${q}”`} subtitle={`${res.data?.results.length ?? 0} results`} />
      {res.isLoading ? <LoadingBlock /> : !groups.size ? <Card><EmptyState title="No matches" message="Try a client name, invoice number, amount (e.g. 30) or date (YYYY-MM-DD)." /></Card> : (
        <Stack spacing={2}>
          {[...groups.entries()].map(([type, items]) => (
            <Card key={type}>
              <Typography variant="subtitle2" sx={{ px: 2, pt: 1.5 }}>{titleCase(type)}s</Typography>
              <List dense>
                {items.map((r, i) => (
                  <Box key={r.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItemButton onClick={() => nav(r.link)}>
                      <ListItemText primary={r.title} secondary={r.subtitle} />
                      {r.amount !== undefined && r.amount !== null && <Chip size="small" label={money(r.amount)} variant="outlined" />}
                    </ListItemButton>
                  </Box>
                ))}
              </List>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}

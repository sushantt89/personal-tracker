import { useQuery } from '@tanstack/react-query';
import { Box, Card, CardContent, Grid, Stack, Typography, Chip } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import EventRepeatOutlinedIcon from '@mui/icons-material/EventRepeatOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import DonutSmallOutlinedIcon from '@mui/icons-material/DonutSmallOutlined';
import { get } from '../api/client';
import type { Insight } from '../api/types';
import { PageHeader, LoadingBlock, ErrorBlock } from '../components/common';

const ICONS: Record<string, React.ReactNode> = { income: <TrendingUpIcon />, expense: <ShoppingCartOutlinedIcon />, bills: <EventRepeatOutlinedIcon />, work: <WorkOutlineIcon />, savings: <SavingsOutlinedIcon />, budget: <DonutSmallOutlinedIcon /> };
const GROUPS = [['income', 'Income'], ['expense', 'Spending'], ['bills', 'Bills'], ['budget', 'Budgets'], ['work', 'Work'], ['savings', 'This month']] as const;

export default function Insights() {
  const q = useQuery({ queryKey: ['insights'], queryFn: () => get<{ items: Insight[] }>('/insights') });
  return (
    <Box>
      <PageHeader title="Insights" subtitle="Factual summaries of your data. They describe what happened — decisions are yours." />
      {q.isLoading ? <LoadingBlock rows={6} /> : q.error ? <ErrorBlock error={q.error} /> : (
        <Grid container spacing={2}>
          {GROUPS.map(([kind, label]) => {
            const items = (q.data?.items ?? []).filter((i) => i.kind === kind);
            if (!items.length) return null;
            return (
              <Grid key={kind} size={{ xs: 12, md: 6 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, color: 'text.secondary' }}>{ICONS[kind]}<Typography variant="subtitle2" color="text.primary">{label}</Typography></Stack>
                    <Stack spacing={1.25}>
                      {items.map((i) => (
                        <Stack key={i.id} direction="row" spacing={1} alignItems="flex-start">
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', mt: 1, flexShrink: 0, bgcolor: i.tone === 'attention' ? 'warning.main' : i.tone === 'positive' ? 'success.main' : 'text.disabled' }} />
                          <Typography variant="body2" sx={{ flex: 1 }}>{i.text}</Typography>
                          {i.tone === 'attention' && <Chip size="small" label="Note" color="warning" variant="outlined" />}
                        </Stack>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
}

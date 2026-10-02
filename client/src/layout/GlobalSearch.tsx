import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Autocomplete, TextField, InputAdornment, Box, Typography, Chip, Stack } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { get } from '../api/client';
import { money } from '../utils/format';

interface Result { type: string; id: string; title: string; subtitle?: string; amount?: number; link: string }

export default function GlobalSearch({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useNavigate();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(input.trim()), 250); return () => clearTimeout(t); }, [input]);
  const res = useQuery({ queryKey: ['search', q], queryFn: () => get<{ results: Result[] }>('/search', { q }), enabled: q.length >= 2 });
  const options = res.data?.results ?? [];
  return (
    <Autocomplete<Result, false, false, true>
      freeSolo
      sx={{ width: '100%', maxWidth: 440 }}
      options={options}
      filterOptions={(x) => x}
      groupBy={(o) => o.type.charAt(0).toUpperCase() + o.type.slice(1) + 's'}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.title)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      loading={res.isFetching}
      noOptionsText={q.length < 2 ? 'Type at least 2 characters' : 'No matches'}
      onChange={(_, v) => {
        if (v && typeof v === 'object') { nav(v.link); setInput(''); onNavigate?.(); }
        else if (typeof v === 'string' && v.trim()) { nav(`/search?q=${encodeURIComponent(v.trim())}`); onNavigate?.(); }
      }}
      renderOption={(props, o) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>{o.title}</Typography>
                {o.subtitle && <Typography variant="caption" color="text.secondary" noWrap component="div">{o.subtitle}</Typography>}
              </Box>
              {o.amount !== undefined && o.amount !== null && <Chip size="small" label={money(o.amount)} variant="outlined" />}
            </Stack>
          </Box>
        );
      }}
      renderInput={(p) => (
        <TextField {...p} placeholder="Search clients, jobs, invoices, amounts…" size="small"
          slotProps={{ input: { ...p.InputProps, startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
      )}
    />
  );
}

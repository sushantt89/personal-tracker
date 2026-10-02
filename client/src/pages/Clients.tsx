import { Typography, Link, Chip } from '@mui/material';
import { ResourcePage, type ResourceConfig } from '../components/ResourcePage';
import type { Client } from '../api/types';
import { clientFields, clientDefaults, withFormattedAddress } from '../utils/forms';
import { money, mapsUrl } from '../utils/format';
import { useLookupMaps } from '../hooks/useLookups';

export default function Clients() {
  const { srcById } = useLookupMaps();
  const config: ResourceConfig<Client> = {
    queryKey: 'clients', endpoint: '/clients', title: 'Clients & contractors', singular: 'Client or contractor',
    subtitle: 'Clients are the people whose place you work at. Contractors are businesses you work under — they pay you and get your invoices.',
    filters: [{ name: 'type', label: 'Type', options: [{ value: 'client', label: 'Clients' }, { value: 'contractor', label: 'Contractors' }] }],
    fields: clientFields, defaults: clientDefaults, transform: withFormattedAddress,
    fromRecord: (c) => ({ ...c, type: c.type ?? 'client', address: c.address ?? {} }),
    columns: [
      { key: 'name', label: 'Name', render: (c) => <><Typography variant="body2" fontWeight={500}>{c.name}</Typography>{c.contactName && <Typography variant="caption" color="text.secondary">{c.contactName}</Typography>}</> },
      { key: 'type', label: 'Type', render: (c) => <Chip size="small" variant="outlined" color={c.type === 'contractor' ? 'secondary' : 'default'} label={c.type === 'contractor' ? 'Contractor' : 'Client'} />, sortValue: (c) => c.type ?? 'client' },
      { key: 'source', label: 'Source', render: (c) => (c.incomeSourceId ? srcById.get(c.incomeSourceId)?.name : '—') },
      { key: 'address', label: 'Address', render: (c) => (c.address?.formatted ? <Link href={mapsUrl(c.address.formatted)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} color="inherit" underline="hover">{c.address.formatted}</Link> : '—') },
      { key: 'phone', label: 'Contact', render: (c) => [c.phone, c.email].filter(Boolean).join(' · ') || '—' },
      { key: 'defaultRate', label: 'Rate', align: 'right', render: (c) => (c.defaultRate ? money(c.defaultRate) : '—') },
    ],
    mobileTitle: (c) => c.name,
    mobileSubtitle: (c) => `${c.type === 'contractor' ? 'Contractor · ' : ''}${c.address?.formatted ?? c.phone ?? ''}`,
    deleteMessage: () => 'Jobs and income for this client are kept; they just lose the client link.',
  };
  return <ResourcePage config={config} />;
}

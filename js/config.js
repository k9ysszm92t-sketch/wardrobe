const CONFIG = {
  supabase: {
    url: 'https://YOUR_PROJECT.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_KEY',
  },
  worker: {
    url: 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev',
  },
  weather: {
    latitude: 45.4215,
    longitude: -75.6972,
    city: 'Ottawa',
  },
  styleIndex: {
    // Rebuilt nightly by GitHub Action — do not edit manually
    path: './data/style-index.json',
  },
  calendar: {
    weeksBack: 1,
    weeksAhead: 1,
  },
};

export default CONFIG;

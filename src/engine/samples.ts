export interface Sample {
  id: string;
  label: string;
  value: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'jwt',
    label: 'JWT',
    value:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsInJvbGUiOiJhbmFseXN0IiwiaWF0IjoxNzM1Njg5NjAwLCJleHAiOjE3NjcyMjU2MDB9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  },
  {
    id: 'double-base64',
    label: 'Double Base64',
    value: 'VkdobElIRjFhV05ySUdKeWIzZHVJR1p2ZUNCcWRXMXdjeUJ2ZG1WeUlIUm9aU0JzWVhwNUlHUnZaeTQ9',
  },
  {
    id: 'url-encoded',
    label: 'URL encoded',
    value: '%3Fq%3D%3Cscript%3Ealert(1)%3C%2Fscript%3E%26next%3D%2Fadmin%2Fpanel',
  },
  {
    id: 'gzip-base64',
    label: 'Gzipped JSON',
    value:
      'H4sIAAAAAAAACgXBSwqAMAwFwLu8dS1RC0JuE0tE8UNpk27EuzvzQrs+Boa47XGT4/KqCPCmFYzW87BKPr0goNUMxkhxojhTTIQAMdO7WAOn5fsBw+nWcE4AAAA=',
  },
  {
    id: 'powershell',
    label: 'Encoded PowerShell',
    value:
      'RwBlAHQALQBQAHIAbwBjAGUAcwBzACAAfAAgAFcAaABlAHIAZQAtAE8AYgBqAGUAYwB0ACAAewAkAF8ALgBDAFAAVQAgAC0AZwB0ACAAMQAwADAAfQA=',
  },
  {
    id: 'hex',
    label: 'Hex',
    value: '4661696c656420746f2061757468656e746963617465206167656e74202331373a2074696d656f7574',
  },
];

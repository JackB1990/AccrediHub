import { db } from '../server/hatchable.js';

export const access = 'user';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  if (req.method === 'GET') {
    const agencies = (await db.query(
      'SELECT id, company, notes, created_at FROM pr_agencies ORDER BY company ASC'
    )).rows;

    const contacts = (await db.query(
      'SELECT id, agency_id, name, email, phone FROM pr_contacts ORDER BY name ASC'
    )).rows;
    const contactsByAgency = {};
    for (const c of contacts) (contactsByAgency[c.agency_id] = contactsByAgency[c.agency_id] || []).push(c);

    const links = (await db.query(
      `SELECT apc.id, apc.artist_id, a.name AS artist_name, apc.agency_id,
              apc.contact_id, c.name AS contact_name, apc.notes
         FROM artist_pr_contacts apc
         JOIN artists a ON a.id = apc.artist_id
         LEFT JOIN pr_contacts c ON c.id = apc.contact_id
        ORDER BY a.name ASC`
    )).rows;
    const linksByAgency = {};
    for (const l of links) (linksByAgency[l.agency_id] = linksByAgency[l.agency_id] || []).push(l);

    for (const a of agencies) {
      a.contacts = contactsByAgency[a.id] || [];
      a.artists = linksByAgency[a.id] || [];
    }
    return res.json({ agencies });
  }

  // POST - find-or-create by case-insensitive company name.
  const company = (req.body.company || '').trim();
  if (!company) return res.status(400).json({ error: 'Company name is required.' });
  const notes = req.body.notes || null;

  const existing = await db.query('SELECT id, company, notes, created_at FROM pr_agencies WHERE lower(company) = lower($1)', [company]);
  if (existing.rows.length) {
    return res.json({ agency: existing.rows[0], existed: true });
  }
  const result = await db.query(
    'INSERT INTO pr_agencies (company, notes) VALUES ($1, $2) RETURNING id, company, notes, created_at',
    [company, notes]
  );
  return res.status(201).json({ agency: result.rows[0] });
}

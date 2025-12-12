import dotenv from 'dotenv';

dotenv.config();

const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY;
const FIREFLIES_GRAPHQL_ENDPOINT = process.env.FIREFLIES_GRAPHQL_ENDPOINT || 'https://api.fireflies.ai/graphql';

export interface FirefliesMeeting {
  id: string;
  title: string;
  date: Date;
}

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!FIREFLIES_API_KEY) {
    throw new Error('FIREFLIES_API_KEY is not set');
  }

  const response = await fetch(FIREFLIES_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIREFLIES_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Fireflies API error: ${response.status} ${response.statusText} ${text}`);
  }

  const data = await response.json();
  if (data.errors?.length) {
    throw new Error(`Fireflies GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  return data.data as T;
}

export async function listRecentMeetings(limit: number): Promise<FirefliesMeeting[]> {
  const query = `
    query ListMeetings($limit: Int!) {
      transcripts(limit: $limit) {
        id
        title
        date
      }
    }
  `;

  type Resp = { transcripts: Array<{ id: string; title: string; date: number }> };
  const data = await graphqlRequest<Resp>(query, { limit });
  const items = data.transcripts || [];
  return items.map(m => ({
    id: m.id,
    title: m.title || 'Untitled Meeting',
    date: new Date(m.date)
  }));
}

export async function getMeetingSummaryForExtraction(meetingId: string): Promise<string> {
  const query = `
    query GetTranscript($id: String!) {
      transcript(id: $id) {
        id
        title
        summary {
          action_items
          overview
          shorthand_bullet
        }
      }
    }
  `;
  type Resp = {
    transcript: {
      id: string;
      title: string;
      summary?: {
        action_items?: string;
        overview?: string;
        shorthand_bullet?: string;
      };
    } | null;
  };
  const data = await graphqlRequest<Resp>(query, { id: meetingId });
  const transcript = data.transcript;
  if (!transcript) {
    throw new Error(`Meeting not found: ${meetingId}`);
  }

  const summary = transcript.summary;
  if (!summary) {
    throw new Error(`No summary available for meeting ${meetingId}`);
  }

  // Combine all summary fields into a comprehensive text for Claude
  const parts: string[] = [];

  if (summary.overview) {
    parts.push('## Overview\n' + summary.overview.trim());
  }

  if (summary.action_items) {
    parts.push('## Action Items\n' + summary.action_items.trim());
  }

  if (summary.shorthand_bullet) {
    parts.push('## Meeting Notes\n' + summary.shorthand_bullet.trim());
  }

  if (parts.length === 0) {
    throw new Error(`No summary content available for meeting ${meetingId}`);
  }

  return parts.join('\n\n');
}

export function __debugEndpoint(): string {
  return FIREFLIES_GRAPHQL_ENDPOINT;
}

import { generateDaySplitModule } from '@/lib/groq';

export async function POST(request) {
  try {
    const body = await request.json();
    const { subject, gradeLevel, topic, totalDays, hoursPerDay, existingContent } = body;

    if (!subject || !gradeLevel || !topic) {
      return Response.json({ error: 'subject, gradeLevel, and topic are required.' }, { status: 400 });
    }

    const days = Number(totalDays) || 5;
    if (days < 4 || days > 5) {
      return Response.json({ error: 'totalDays must be 4 or 5.' }, { status: 400 });
    }

    const hours = Number(hoursPerDay) || 1;
    if (hours < 1 || hours > 2) {
      return Response.json({ error: 'hoursPerDay must be between 1 and 2.' }, { status: 400 });
    }

    // Server-held key only — the client never sends or sees this, so
    // co-teachers using the hosted app never need their own Groq account.
    const groqApiKey = process.env.GROQ_API_KEY;

    const { data, model, fallback } = await generateDaySplitModule({
      groqApiKey,
      subject,
      gradeLevel,
      topic,
      totalDays: days,
      hoursPerDay: hours,
      existingContent: existingContent || undefined,
    });

    data.meta = { subject, gradeLevel, topic, totalDays: days, hoursPerDay: hours };

    return Response.json({ data, model, fallback });
  } catch (error) {
    console.error('generate-module error:', error);
    return Response.json({ error: error.message || 'Failed to generate lesson deck content.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const credentials = await db.credential.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        service: true,
        label: true,
        maskedPreview: true,
        serviceUrl: true,
        isActive: true,
        lastTestedAt: true,
        testResult: true,
        testDetails: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ credentials });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch credentials' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.service || !body.label) {
      return NextResponse.json({ error: 'service and label are required' }, { status: 400 });
    }

    // Generate a masked preview from the encrypted data
    const maskedPreview = generateMaskedPreview(body.service, body.encryptedData);

    const credential = await db.credential.create({
      data: {
        service: body.service,
        label: body.label,
        encryptedData: body.encryptedData,
        maskedPreview,
        serviceUrl: body.serviceUrl || null,
        isActive: body.isActive ?? true,
      },
    });

    await db.auditLog.create({
      data: {
        action: 'CREATE_CREDENTIAL',
        entityType: 'Credential',
        entityId: credential.id,
        details: `Credential "${body.label}" for service "${body.service}" created${body.serviceUrl ? ` (URL: ${body.serviceUrl})` : ''}`,
      },
    });

    // Return without encrypted data
    const { encryptedData: _, ...safeCredential } = credential;

    return NextResponse.json(safeCredential, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create credential' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.label !== undefined) updateData.label = body.label;
    if (body.encryptedData !== undefined) {
      updateData.encryptedData = body.encryptedData;
      updateData.maskedPreview = generateMaskedPreview(body.service || '', body.encryptedData);
    }
    if (body.serviceUrl !== undefined) updateData.serviceUrl = body.serviceUrl;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.lastTestedAt !== undefined) updateData.lastTestedAt = new Date(body.lastTestedAt);
    if (body.testResult !== undefined) updateData.testResult = body.testResult;
    if (body.testDetails !== undefined) updateData.testDetails = body.testDetails;

    const credential = await db.credential.update({
      where: { id: body.id },
      data: updateData,
    });

    await db.auditLog.create({
      data: {
        action: 'UPDATE_CREDENTIAL',
        entityType: 'Credential',
        entityId: credential.id,
        details: `Credential "${credential.label}" for service "${credential.service}" updated`,
      },
    });

    const { encryptedData: _, ...safeCredential } = credential;

    return NextResponse.json(safeCredential);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update credential' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const credential = await db.credential.findUnique({ where: { id } });

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
    }

    await db.credential.delete({ where: { id } });

    await db.auditLog.create({
      data: {
        action: 'DELETE_CREDENTIAL',
        entityType: 'Credential',
        entityId: id,
        details: `Credential "${credential.label}" for service "${credential.service}" deleted`,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete credential' }, { status: 500 });
  }
}

function generateMaskedPreview(service: string, encryptedData: string): string {
  if (!encryptedData) return '****';

  try {
    const data = JSON.parse(encryptedData);
    const keyPatterns = ['apiKey', 'api_key', 'key', 'privateKey', 'secret', 'token', 'password'];
    for (const pattern of keyPatterns) {
      if (data[pattern]) {
        const val = String(data[pattern]);
        if (val.length > 8) {
          return val.slice(0, 3) + '****' + val.slice(-4);
        }
        return '****' + val.slice(-4);
      }
    }
    return `****${encryptedData.slice(-4)}`;
  } catch {
    return '****' + encryptedData.slice(-4);
  }
}

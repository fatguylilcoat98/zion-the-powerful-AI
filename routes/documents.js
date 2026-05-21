/*
  Zion — Document Upload & Management System
  Built by Christopher Hughes for Tiffani
  Truth · Wisdom · Power
*/

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { requireAuth, requireOwner } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-originalname
    const timestamp = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${sanitizedName}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Allow common document types
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not supported'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Upload a document
router.post('/upload', requireAuth, requireOwner, upload.single('document'), async (req, res) => {
  try {
    const { title, description, category } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read file content for text extraction (basic implementation)
    let extractedText = '';
    try {
      if (file.mimetype === 'text/plain') {
        const fileBuffer = await fs.readFile(file.path);
        extractedText = fileBuffer.toString('utf-8');
      }
      // Additional text extraction can be added here for PDF, DOCX, etc.
    } catch (extractionError) {
      console.warn('Text extraction failed:', extractionError.message);
    }

    // Store document metadata in database
    const { data: document, error } = await supabase
      .from('documents')
      .insert({
        user_id: req.userId,
        title: title || file.originalname,
        description: description || '',
        category: category || 'general',
        filename: file.filename,
        original_name: file.originalname,
        file_path: file.path,
        mime_type: file.mimetype,
        file_size: file.size,
        extracted_text: extractedText.substring(0, 10000), // Limit text for storage
        uploaded_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      // Clean up uploaded file if database insert fails
      await fs.unlink(file.path).catch(() => {});
      throw error;
    }

    console.log(`[DOCUMENTS] Uploaded: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB) for user ${req.userId}`);

    res.json({
      success: true,
      document: {
        id: document.id,
        title: document.title,
        filename: document.original_name,
        size: file.size,
        type: file.mimetype,
        uploaded_at: document.uploaded_at
      }
    });

  } catch (error) {
    console.error('Document upload error:', error);

    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(500).json({
      error: 'Upload failed',
      message: error.message
    });
  }
});

// Get user's documents
router.get('/', requireAuth, requireOwner, async (req, res) => {
  try {
    const { category, limit = 50 } = req.query;

    let query = supabase
      .from('documents')
      .select('id, title, description, category, original_name, mime_type, file_size, uploaded_at')
      .eq('user_id', req.userId)
      .order('uploaded_at', { ascending: false })
      .limit(parseInt(limit));

    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    const { data: documents, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      documents: documents || []
    });

  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      error: 'Failed to fetch documents',
      message: error.message
    });
  }
});

// Get document content for AI processing
router.get('/:documentId/content', requireAuth, requireOwner, async (req, res) => {
  try {
    const { documentId } = req.params;

    const { data: document, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('user_id', req.userId)
      .single();

    if (error || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Return extracted text for AI processing
    res.json({
      success: true,
      document: {
        id: document.id,
        title: document.title,
        content: document.extracted_text,
        type: document.mime_type,
        uploaded_at: document.uploaded_at
      }
    });

  } catch (error) {
    console.error('Error fetching document content:', error);
    res.status(500).json({
      error: 'Failed to fetch document content',
      message: error.message
    });
  }
});

// Delete a document
router.delete('/:documentId', requireAuth, requireOwner, async (req, res) => {
  try {
    const { documentId } = req.params;

    // Get document info first
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', documentId)
      .eq('user_id', req.userId)
      .single();

    if (fetchError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId)
      .eq('user_id', req.userId);

    if (deleteError) throw deleteError;

    // Delete physical file
    try {
      await fs.unlink(document.file_path);
    } catch (fileError) {
      console.warn('Failed to delete physical file:', fileError.message);
    }

    console.log(`[DOCUMENTS] Deleted document ${documentId} for user ${req.userId}`);

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      error: 'Failed to delete document',
      message: error.message
    });
  }
});

// Download a document
router.get('/:documentId/download', requireAuth, requireOwner, async (req, res) => {
  try {
    const { documentId } = req.params;

    const { data: document, error } = await supabase
      .from('documents')
      .select('file_path, original_name, mime_type')
      .eq('id', documentId)
      .eq('user_id', req.userId)
      .single();

    if (error || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check if file exists
    try {
      await fs.access(document.file_path);
    } catch {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    // Set appropriate headers
    res.setHeader('Content-Disposition', `attachment; filename="${document.original_name}"`);
    res.setHeader('Content-Type', document.mime_type);

    // Stream the file
    res.sendFile(path.resolve(document.file_path));

  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({
      error: 'Download failed',
      message: error.message
    });
  }
});

module.exports = router;
import { Router } from 'express';
import passport from 'passport';
import { body } from 'express-validator';
import multer from 'multer';
import path from 'path';
import { GenerationController } from '../controllers/generation.controller';

const generationRouter = Router();
const controller = new GenerationController();

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'pdf-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

const validateCreateJob = [
  body('pdf_url').optional().isURL(),
  body('prompt_template_id').optional().isInt(),
  body('prompt_category').optional().isString(),
  body('custom_prompt').optional().isString(),
  body('ai_enhancement').optional().isBoolean(),
  body('model_provider').optional().isString(),
  body('model_name').optional().isString(),
  body('publish_to_wp').optional().isBoolean(),
];

// All routes require authentication
generationRouter.use(passport.authenticate('jwt', { session: false }));

// Submit a new generation job
generationRouter.post(
  '/',
  upload.single('pdf_file'),
  validateCreateJob,
  controller.createJob.bind(controller)
);

// Get list of jobs
generationRouter.get('/', controller.listJobs.bind(controller));

// Get specific job details
generationRouter.get('/:jobId', controller.getJob.bind(controller));

// Cancel a job
generationRouter.post('/:jobId/cancel', controller.cancelJob.bind(controller));

// Get generated article
generationRouter.get('/articles/:articleId', controller.getArticle.bind(controller));

export default generationRouter;

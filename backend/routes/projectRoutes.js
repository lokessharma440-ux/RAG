import express from 'express';
import { Project } from '../models/Project.js';
import mongoose from 'mongoose';

const router = express.Router();

// Seed initial sample projects if database is empty
const defaultProjects = [
  {
    title: 'MERN E-Commerce Storefront',
    description: 'High-performance microservices-backed online shop with Stripe payment processing, cart caching, and admin analytics.',
    techStack: ['MongoDB', 'Express', 'React', 'Node.js', 'Redux Toolkit'],
    status: 'In Progress',
    priority: 'High',
    githubUrl: 'https://github.com/developer/mern-storefront',
    liveUrl: 'https://storefront-demo.dev',
  },
  {
    title: 'AI Prompt Studio & Pipeline',
    description: 'Collaborative prompt engineering workspace with streaming completions, version control, and token usage optimization.',
    techStack: ['React', 'Node.js', 'Express', 'MongoDB', 'OpenAI API'],
    status: 'Completed',
    priority: 'Critical',
    githubUrl: 'https://github.com/developer/prompt-studio',
    liveUrl: 'https://promptstudio.dev',
  },
  {
    title: 'Cloud DevOps Telemetry Dashboard',
    description: 'Real-time infrastructure observability system monitoring cluster pods, memory utilization, and latency metrics.',
    techStack: ['React', 'Express', 'Node.js', 'WebSocket', 'MongoDB'],
    status: 'Planned',
    priority: 'Medium',
    githubUrl: 'https://github.com/developer/cloud-telemetry',
    liveUrl: '',
  },
];

// GET all projects
router.get('/', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'MongoDB is currently connecting or offline. Please ensure MongoDB is running.',
        data: [],
      });
    }

    let projects = await Project.find().sort({ createdAt: -1 });

    // Auto-seed initial demo projects if collection is empty
    if (projects.length === 0) {
      await Project.insertMany(defaultProjects);
      projects = await Project.find().sort({ createdAt: -1 });
    }

    res.status(200).json({
      success: true,
      count: projects.length,
      data: projects,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error retrieving projects',
      error: error.message,
    });
  }
});

// GET single project
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    res.status(200).json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create project
router.post('/', async (req, res) => {
  try {
    const { title, description, techStack, status, priority, githubUrl, liveUrl } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const newProject = await Project.create({
      title: title.trim(),
      description: description ? description.trim() : '',
      techStack: Array.isArray(techStack)
        ? techStack
        : (techStack || '').split(',').map(s => s.trim()).filter(Boolean),
      status: status || 'In Progress',
      priority: priority || 'Medium',
      githubUrl: githubUrl || '',
      liveUrl: liveUrl || '',
    });

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: newProject,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// PUT update project
router.put('/:id', async (req, res) => {
  try {
    const { title, description, techStack, status, priority, githubUrl, liveUrl } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (techStack !== undefined) {
      updateData.techStack = Array.isArray(techStack)
        ? techStack
        : techStack.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (githubUrl !== undefined) updateData.githubUrl = githubUrl.trim();
    if (liveUrl !== undefined) updateData.liveUrl = liveUrl.trim();

    const updated = await Project.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Project updated successfully',
      data: updated,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE project
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Project.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Project deleted successfully',
      data: { id: req.params.id },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

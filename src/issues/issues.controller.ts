import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IssuesService } from './issues.service';
import { CreateIssueCategoryDto } from './dto/create-issue-category.dto';
import { UpdateIssueCategoryDto } from './dto/update-issue-category.dto';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { CreateIssueSolutionDto } from './dto/create-issue-solution.dto';
import { UpdateIssueSolutionDto } from './dto/update-issue-solution.dto';
import { ReportInspectionIssueDto } from './dto/report-inspection-issue.dto';
import { ExecuteSolutionActionDto } from './dto/execute-solution-action.dto';
import { UpdateInspectionIssueStatusDto } from './dto/update-inspection-issue-status.dto';

@Controller('issues')
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Post('categories')
  createCategory(@Body() dto: CreateIssueCategoryDto) {
    return this.issuesService.createCategory(dto);
  }

  @Get('categories')
  getCategories() {
    return this.issuesService.getCategories();
  }

  @Get('categories/:id')
  getCategory(@Param('id', ParseIntPipe) id: number) {
    return this.issuesService.getCategory(id);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIssueCategoryDto,
  ) {
    return this.issuesService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id', ParseIntPipe) id: number) {
    return this.issuesService.deleteCategory(id);
  }

  /*
   * مهم جدًا:
   * Routes دي لازم تكون قبل @Get(':id')
   */

  @Get('device-type/:deviceTypeId')
  getIssuesByDeviceType(
    @Param('deviceTypeId', ParseIntPipe) deviceTypeId: number,
  ) {
    return this.issuesService.getIssuesByDeviceType(deviceTypeId);
  }

  @Get(':issueId/solutions')
  getSolutionsByIssue(@Param('issueId', ParseIntPipe) issueId: number) {
    return this.issuesService.getSolutionsByIssue(issueId);
  }

  @Post('inspection/report')
  reportInspectionIssue(@Body() dto: ReportInspectionIssueDto) {
    return this.issuesService.reportInspectionIssue(dto);
  }

  @Get('inspection/:inspectionId/reported')
  getInspectionIssuesByInspection(
    @Param('inspectionId', ParseIntPipe) inspectionId: number,
  ) {
    return this.issuesService.getInspectionIssuesByInspection(inspectionId);
  }

  @Get('inspection-item/:id')
  getInspectionIssue(@Param('id', ParseIntPipe) id: number) {
    return this.issuesService.getInspectionIssue(id);
  }

  @Post('inspection/action')
  executeSolutionAction(@Body() dto: ExecuteSolutionActionDto) {
    return this.issuesService.executeSolutionAction(dto);
  }

  @Patch('inspection-item/:id/status')
  updateInspectionIssueStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInspectionIssueStatusDto,
  ) {
    return this.issuesService.updateInspectionIssueStatus(id, dto);
  }

  @Post('solutions')
  createSolution(@Body() dto: CreateIssueSolutionDto) {
    return this.issuesService.createSolution(dto);
  }

  @Patch('solutions/:id')
  updateSolution(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIssueSolutionDto,
  ) {
    return this.issuesService.updateSolution(id, dto);
  }

  @Delete('solutions/:id')
  deleteSolution(@Param('id', ParseIntPipe) id: number) {
    return this.issuesService.deleteSolution(id);
  }

  @Post()
  createIssue(@Body() dto: CreateIssueDto) {
    return this.issuesService.createIssue(dto);
  }

  @Get()
  getIssues(
    @Query('categoryId') categoryId?: string,
    @Query('deviceTypeId') deviceTypeId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.issuesService.getIssues({
      categoryId: categoryId ? Number(categoryId) : undefined,
      deviceTypeId: deviceTypeId ? Number(deviceTypeId) : undefined,
      status,
      search,
    });
  }

  /*
   * لازم يكون تحت كل الـ custom GET routes
   */
  @Get(':id')
  getIssue(@Param('id', ParseIntPipe) id: number) {
    return this.issuesService.getIssue(id);
  }

  @Patch(':id')
  updateIssue(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIssueDto,
  ) {
    return this.issuesService.updateIssue(id, dto);
  }

  @Delete(':id')
  deleteIssue(@Param('id', ParseIntPipe) id: number) {
    return this.issuesService.deleteIssue(id);
  }
}
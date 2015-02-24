<?php
/**
 * Config Controller
 *
 * @category   ManneBusk
 * @package    ManneBusk_DevPanel
 * @author     Manne Busk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_AutofillController extends Mage_Core_Controller_Front_Action
{
    /**
     * Index Action
     * Render json response with xml config
     *
     */
    public function saveAction()
    {
        $this->loadLayout();

        $dir    = Mage::getBaseDir('var') . DS . 'devpanel' . DS . 'form' . DS;
        $params = new Varien_Object($this->getRequest()->getParams());
        $json   = $params->getJson();
        $file   = $dir . DS . $params->getName() . '.json';

        if (file_exists($file)) {
            return $this->_sendError('File already exists');
        }

        try {
            if (!is_dir($dir)) {
                mkdir($dir, 0777, true);
            }

            $fHandle = fopen($file, 'w');
            fwrite($fHandle, $json);
            fclose($fHandle);
        } catch (Exception $e) {
            $this->_sendError($e->getMessage());
        }

        $this->_sendSuccess("File created successfully");
    }

    /**
     * Index Action
     * Render json response with xml config
     *
     */
    public function deleteAction()
    {
        $this->loadLayout();

        $dir    = Mage::getBaseDir('var') . DS . 'devpanel' . DS . 'form' . DS;
        $params = new Varien_Object($this->getRequest()->getParams());
        $file   = $dir . DS . $params->getName() . '.json';

        if (!file_exists($file)) {
            return $this->_sendError('File not found.');
        }

        try {
            unlink($file);
        } catch (Exception $e) {
            $this->_sendError($e->getMessage());
        }

        $this->_sendSuccess("File Deleted");
    }

    /**
     * Send success
     *
     * @param string $output
     */
    protected function _sendSuccess($msg)
    {
        $output = $this->getLayout()->createBlock('devpanel/ajax_output', 'ajaxMessage');
        $output->setMessage($msg);
        $output->setFormsHtml(Mage::helper('devpanel/autofill')->getFormsHtml());
        $output->setForms(Mage::helper('devpanel/autofill')->getForms());
        $this->_renderJsonAjax($output);
    }

    /**
     * Send error 
     *
     * @param string $output
     */
    protected function _sendError($msg)
    {
        $output = $this->getLayout()->createBlock('devpanel/ajax_output', 'ajaxMessage');
        $output->setMessage($msg);
        $output->setStatusClass('error');
        $output->setFormsHtml(Mage::helper('devpanel/autofill')->getFormsHtml());
        $output->setForms(Mage::helper('devpanel/autofill')->getForms());
        $this->_renderJsonAjax($output);
    }

    /**
     * Send application/json response
     *
     * @param string $output
     */
    protected function _renderJsonAjax($output)
    {
        Mage::app()->getResponse()
            ->setHeader('Content-Type', 'application/json', true)
            ->setBody($output->getJSON())
            ->sendResponse();
        exit;
    }
}

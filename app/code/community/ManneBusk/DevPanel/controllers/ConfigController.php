<?php
/**
 * Config Controller
 *
 * @category   ManneBusk
 * @package    ManneBusk_DevPanel
 * @author     Manne Busk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_ConfigController extends Mage_Core_Controller_Front_Action
{
    /**
     * Index Action
     * Render json response with xml config
     *
     */
    public function indexAction()
    {
        $output = $this->_getConfigXml($this->getRequest());

        $max = 1000 * 80;
        if (strlen($output) > $max) {
            $data = json_encode(
                array(
                    'redirect' => Mage::getUrl('*/*/xml', array('_query' => $this->getRequest()->getParams()))
                ),
                JSON_PRETTY_PRINT
            );
            Mage::app()->getResponse()
                ->setHeader('Content-Type', 'application/json', true)
                ->setBody($data)
                ->sendResponse();
            exit;
        }

        $this->_renderJsonAjax($output);
    }

    /**
     * Xml Action
     * Render xml config as normal XML response
     *
     */
    public function xmlAction()
    {
        $this->_renderXml($this->_getConfigXml($this->getRequest()));
    }

    /**
     * Get configuration XML filtered by xPath
     *
     * @param Mage_Core_Controller_Request_Http $request
     *
     * @return string
     */
    protected function _getConfigXml($request)
    {
        $xpath   = $request->getParam('xpath');
        $config = Mage::app()->getConfig();
        $output = $config->getNode()->asNiceXml('', 0);

        if ($xpath && $xml = $config->getXpath($xpath)) {
            $output = "";
            foreach ($xml as $elem) {
                $output .= $elem->asNiceXml('', 0);
            }
        }

        return $output;
    }

    /**
     * Send application/xml response
     *
     * @param string $output
     */
    protected function _renderXml($output)
    {
        Mage::app()->getResponse()
            ->setHeader('Content-Type', 'application/xml', true)
            ->setBody($output)
            ->sendResponse();
        exit;
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
            ->setBody(json_encode(array('html' => $output), JSON_PRETTY_PRINT))
            ->sendResponse();
        exit;
    }
}
